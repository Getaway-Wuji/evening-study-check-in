import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {defaultRules,dateCN,addDays} from '../lib/domain';
import {makeupWindow,resolveClassPolicy} from '../lib/class-policy';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/makeup-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,run,one,rows,settings}=await import('../lib/db');
const {command,bootstrap,createSession}=await import('../lib/service');
await ready();
const admin={id:'admin',code:'teacher',name:'测试管理员',role:'admin'},other={id:'other',code:'other',name:'其他同学',role:'student'};
for(const u of [admin,other])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
let sequence=0;
async function fixture(offset=0){
  const id='s'+(++sequence),student={id,code:id,name:'测试学生'+sequence,role:'student'};
  await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[id,id,student.name,'student',Date.now()]);
  const date=addDays(dateCN(),offset),rules={...defaultRules,open:'00:00',close:'23:59',locationConfirmed:true,proofRequired:{personal:false,sick:false,free:false}};
  let session=await one('SELECT id FROM sessions WHERE date=?',[date]);
  if(!session)session={id:await createSession(date,db(),rules)};
  await run('INSERT OR IGNORE INTO session_members(session_id,user_id) VALUES(?,?)',[session.id,id]);
  await run("INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,'image/png',100,?,1,'photo',?)",[id+'-photo',id,'现场.png',id,Date.now()]);
  const input={sessionId:session.id,reason:'在教室现场多次定位失败，申请核实到场',failureNote:'等待后仍提示定位失败',photoIds:[id+'-photo']};
  return {student,sessionId:session.id,rules,input,apply:()=>command(student,{action:'makeup.create',data:input})};
}
const review=(id:string,decision='approved',note='已核对现场照片及值班人员到场确认')=>command(admin,{action:'makeup.review',data:{id,decision,note}});
test('旧设置获得可配置补签规则，截止时间含正常截止分钟且使用中国时区',()=>{
  const policy=resolveClassPolicy();assert.equal(policy.makeup.enabled,true);assert.equal(policy.makeup.hoursAfterClose,24);
  const w=makeupWindow('2026-10-31',defaultRules,policy);
  assert.equal(w.opensAt,Date.parse('2026-10-31T17:30:00+08:00'));
  assert.equal(w.closesAt,Date.parse('2026-11-01T18:06:00+08:00'));
});
test('现场照片与说明必填，附件归属、格式和上传完成状态必须正确',async()=>{
  const f=await fixture();
  for(const extra of [{photoIds:[]},{reason:'短'},{photoIds:[f.input.photoIds[0],f.input.photoIds[0]]},{photoIds:['missing']}])await assert.rejects(command(f.student,{action:'makeup.create',data:{...f.input,...extra}}));
  for(const [id,owner,mime,ready,purpose] of [['foreign','other','image/png',1,'photo'],['unfinished',f.student.id,'image/png',0,'photo'],['pdf',f.student.id,'application/pdf',1,'photo'],['proof',f.student.id,'image/png',1,'proof']] as const){
    await run('INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,?,100,?,?,?,?)',[id,owner,id,mime,id,ready,purpose,Date.now()]);
    await assert.rejects(command(f.student,{action:'makeup.create',data:{...f.input,photoIds:[id]}}));
  }
  assert.equal((await one('SELECT COUNT(*) n FROM makeup_requests WHERE user_id=?',[f.student.id])).n,0);
});
test('并发重复申请只保留一份待审，未经审核不产生签到，学生仅能读取自己的材料',async()=>{
  const f=await fixture(),results=await Promise.all(Array.from({length:10},()=>f.apply()));
  assert.equal(new Set(results.map(r=>r.id)).size,1);
  assert.equal((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',[f.student.id])).n,0);
  const data=await bootstrap(f.student),outsider=await bootstrap(other);
  assert.equal(data.makeups.length,1);assert.deepEqual(data.makeups[0].photoIds,f.input.photoIds);assert.equal(data.makeups[0].rule_snapshot,undefined);
  assert.equal(outsider.makeups.length,0);assert.ok(outsider.files.every(p=>p.user_id===other.id));
  await assert.rejects(command(f.student,{action:'makeup.review',data:{id:results[0].id,decision:'approved',note:'自己审批'}}),/权限/);
  await assert.rejects(command(other,{action:'makeup.withdraw',data:{id:results[0].id}}),/他人/);
  await assert.rejects(command(admin,{action:'makeup.create',data:f.input}),/权限/);
});
test('审核意见必填；并发通过只写一条成功记录，照片、规则与审核人可追溯且不伪造坐标',async()=>{
  const f=await fixture(),result=await f.apply();
  await assert.rejects(review(result.id,'approved',''),/核实/);
  await run('UPDATE sessions SET rules_json=?,version=version+1 WHERE id=?',[JSON.stringify({...f.rules,locationName:'调整后的其他教室'}),f.sessionId]);
  const outcomes=await Promise.allSettled(Array.from({length:8},()=>review(result.id)));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const request=await one('SELECT * FROM makeup_requests WHERE id=?',[result.id]),checkins=await rows('SELECT * FROM checkins WHERE user_id=?',[f.student.id]);
  assert.equal(request.status,'approved');assert.equal(request.reviewer_id,admin.id);assert.equal(checkins.length,1);
  const c=checkins[0];assert.equal(request.checkin_id,c.id);assert.equal(c.source_coords,'makeup:'+result.id);assert.deepEqual(JSON.parse(c.photo_ids),f.input.photoIds);assert.equal(c.latitude,null);assert.equal(c.accuracy,null);assert.equal(c.rule_snapshot,request.rule_snapshot);
  const data=await bootstrap(f.student);assert.equal(data.checkins[0].method,'makeup');assert.equal(data.makeups[0].locationName,f.rules.locationName);
  await assert.rejects(f.apply(),/已成功打卡/);
  await run('UPDATE sessions SET rules_json=? WHERE id=?',[JSON.stringify(f.rules),f.sessionId]);
});
test('学生可撤回待审申请，驳回需原因；撤回或驳回后可在期限内重新申请',async()=>{
  const f=await fixture(),first=await f.apply();await command(f.student,{action:'makeup.withdraw',data:{id:first.id}});
  await assert.rejects(review(first.id),/已处理/);
  const second=await f.apply();await assert.rejects(review(second.id,'rejected',''),/原因/);await review(second.id,'rejected','现场材料不能确认到场');
  const third=await f.apply();assert.notEqual(first.id,third.id);assert.notEqual(second.id,third.id);
  await assert.rejects(command(f.student,{action:'makeup.withdraw',data:{id:second.id}}),/不能撤回/);
});
test('后台开关和申请期限生效，不能提前、超期、跨名单或对取消的场次申请',async()=>{
  const f=await fixture(),future=await fixture(1),expired=await fixture(-2);
  await assert.rejects(future.apply(),/提前/);await assert.rejects(expired.apply(),/期限/);
  await run('DELETE FROM session_members WHERE session_id=? AND user_id=?',[f.sessionId,f.student.id]);await assert.rejects(f.apply(),/不适用于/);
  await run('INSERT INTO session_members VALUES(?,?)',[f.sessionId,f.student.id]);
  const policy=(await settings()).policy;policy.makeup.enabled=false;await command(admin,{action:'policy.save',data:policy});await assert.rejects(f.apply(),/未开放/);
  policy.makeup.enabled=true;policy.makeup.hoursAfterClose=1;await command(admin,{action:'policy.save',data:policy});
  const yesterday=await fixture(-1);await run('UPDATE sessions SET rules_json=? WHERE id=?',[JSON.stringify({...yesterday.rules,open:'00:00',close:'01:00'}),yesterday.sessionId]);await assert.rejects(yesterday.apply(),/期限/);
  await run('UPDATE sessions SET cancelled=1 WHERE id=?',[f.sessionId]);await assert.rejects(f.apply(),/取消/);await run('UPDATE sessions SET cancelled=0 WHERE id=?',[f.sessionId]);
  policy.makeup.hoursAfterClose=24;await command(admin,{action:'policy.save',data:policy});
});
test('已提交申请在关闭入口或到期后仍可审核，提交时的规则快照保留',async()=>{
  const f=await fixture(),result=await f.apply(),policy=(await settings()).policy;policy.makeup.enabled=false;await command(admin,{action:'policy.save',data:policy});
  const previousNow=Date.now;
  try{Date.now=()=>makeupWindow(dateCN(previousNow()),f.rules,policy).closesAt+1000;await review(result.id);}finally{Date.now=previousNow;}
  assert.equal((await one('SELECT status FROM makeup_requests WHERE id=?',[result.id])).status,'approved');
  policy.makeup.enabled=true;await command(admin,{action:'policy.save',data:policy});
});
test('申请截止的毫秒边界由服务器校验；审核已取消场次会拒绝且不生成签到',async()=>{
  const f=await fixture(),deadline=makeupWindow(dateCN(),f.rules,(await settings()).policy).closesAt,previousNow=Date.now;
  let id='';
  try{Date.now=()=>deadline-1;id=(await f.apply()).id;Date.now=()=>deadline;await assert.rejects(f.apply(),/期限/);}finally{Date.now=previousNow;}
  await run('UPDATE sessions SET cancelled=1 WHERE id=?',[f.sessionId]);
  await assert.rejects(review(id),/取消/);assert.equal((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',[f.student.id])).n,0);
  await review(id,'rejected','本场晚自习已取消');await run('UPDATE sessions SET cancelled=0 WHERE id=?',[f.sessionId]);
});
test('正常签到和补签审核并发时仅计一次；正常打卡成功自动使待审补签失效',async()=>{
  for(let i=0;i<2;i++){
    const f=await fixture(),result=await f.apply(),normal=()=>command(f.student,{action:'checkin',data:{sessionId:f.sessionId,latitude:f.rules.latitude,longitude:f.rules.longitude,accuracy:10,capturedAt:Date.now(),coordinateSystem:'gcj02'}});
    await Promise.allSettled(i?[review(result.id),normal()]:[normal(),review(result.id)]);
    assert.equal((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',[f.student.id])).n,1);
    assert.equal((await one('SELECT status FROM makeup_requests WHERE id=?',[result.id])).status,i?'approved':'invalid');
  }
});
test('请假审批和补签审核互斥，不同时计入请假及到场；管理员补录也使待审申请失效',async()=>{
  for(let i=0;i<2;i++){
    const f=await fixture(),result=await f.apply(),leave=await command(f.student,{action:'leave.create',data:{sessionIds:[f.sessionId],kind:'free',reason:'测试',proofIds:[]}});
    const approveLeave=()=>command(admin,{action:'leave.review',data:{id:leave.id,decision:'approved',note:'测试核实'}});
    await Promise.allSettled(i?[review(result.id),approveLeave()]:[approveLeave(),review(result.id)]);
    const checked=Number((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',[f.student.id])).n),exempt=Number((await one("SELECT COUNT(*) n FROM leave_items WHERE user_id=? AND status='approved'",[f.student.id])).n);
    assert.equal(checked+exempt,1);if(exempt)await assert.rejects(f.apply(),/请假/);
  }
  const f=await fixture(),result=await f.apply();await command(admin,{action:'attendance.manual',data:{sessionId:f.sessionId,studentId:f.student.id,reason:'已线下核实本人到场'}});
  assert.equal((await one('SELECT status FROM makeup_requests WHERE id=?',[result.id])).status,'invalid');await assert.rejects(review(result.id),/已处理/);
});
test.after(()=>db().close());

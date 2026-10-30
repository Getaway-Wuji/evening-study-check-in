import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
mkdirSync('.local',{recursive:true});
process.env.DATABASE_URL=`file:./.local/test-${crypto.randomUUID()}.db`;
process.env.DEMO_MODE='false';
const {ready,run,rows,one,transaction,db}=await import('../lib/db');
const {command,createSession,bootstrap}=await import('../lib/service');
const {defaultRules,dateCN,addDays}=await import('../lib/domain');
await ready();
const admin={id:'admin',role:'admin',code:'teacher',name:'管理员'},a={id:'a',role:'student',code:'01',name:'学生 A'},b={id:'b',role:'student',code:'02',name:'学生 B'};
for(const u of [admin,a,b])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({className:'测试班',capacity:39,locationConfigured:true,adminEmails:[]})]);
const rules={...defaultRules,open:'00:00',close:'23:59'},sid=await transaction(tx=>createSession(dateCN(),tx,rules,'业务测试'));
const location={latitude:rules.latitude,longitude:rules.longitude,accuracy:10,capturedAt:Date.now(),coordinateSystem:'gcj02'};
test('同一学生并发提交不会产生重复记录',async()=>{
  const outcomes=await Promise.allSettled(Array.from({length:39},()=>command(a,{action:'checkin',data:{sessionId:sid,...location}})));
  assert.equal((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',['a'])).n,1);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,39,JSON.stringify(outcomes));
});
test('缺少证明的请假整体回滚，不留下申请或邮件任务',async()=>{
  await assert.rejects(command(b,{action:'leave.create',data:{sessionIds:[sid],kind:'sick',reason:'测试事由',proofIds:[]}}),/证明/);
  assert.equal((await one('SELECT COUNT(*) n FROM leaves')).n,0);
  assert.equal((await one('SELECT COUNT(*) n FROM email_jobs')).n,0);
});
test('请假保存和通知任务一致，审批与签到并发不会双重计数',async()=>{
  await run("INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES('proof','b','证明.png','image/png',100,'proof',1,'proof',?)",[Date.now()]);
  const result=await command(b,{action:'leave.create',data:{sessionIds:[sid],kind:'sick',reason:'测试事由',proofIds:['proof']}});
  assert.equal((await one('SELECT COUNT(*) n FROM email_jobs')).n,1);
  await Promise.allSettled([
    command(admin,{action:'leave.review',data:{id:result.id,decision:'approved',note:''}}),
    command(b,{action:'checkin',data:{sessionId:sid,...location,capturedAt:Date.now()}}),
  ]);
  const checked=Number((await one("SELECT COUNT(*) n FROM checkins WHERE user_id='b'")).n),approved=Number((await one("SELECT COUNT(*) n FROM leave_items WHERE user_id='b' AND status='approved'")).n);
  assert.equal(checked+approved,1);
});
test('学生不能修改后台规则或读取他人明细',async()=>{
  await assert.rejects(command(a,{action:'settings.save',data:{className:'篡改'}}),/权限/);
  const data=await bootstrap(a);assert.ok(data.checkins.every(c=>c.user_id==='a'));assert.ok(data.leaves.every(l=>l.user_id==='a'));assert.equal(data.students.length,1);assert.equal(data.jobs.length,0);
});
test('临时调整保留已签到记录和规则快照',async()=>{
  const before=await one('SELECT rules_json FROM sessions WHERE id=?',[sid]);
  const result=await command(admin,{action:'session.save',data:{date:dateCN(),rules:{...rules,close:'23:58'},reason:'临时延长测试',cancelled:false}});
  assert.ok(result.message);assert.equal((await one('SELECT COUNT(*) n FROM checkins')).n>=1,true);
  assert.equal((await one('SELECT is_override FROM sessions WHERE id=?',[sid])).is_override,1);
});
test('默认规则只更新未来继承场次，保留单日覆盖',async()=>{
  const future=addDays(dateCN(),3),other=addDays(future,1);
  const inheriting=await transaction(tx=>createSession(future,tx));
  const overridden=await transaction(tx=>createSession(other,tx,{...defaultRules,close:'18:15'},'临时安排'));
  await command(admin,{action:'defaults.save',data:{effectiveFrom:future,rules:{...defaultRules,close:'18:20'}}});
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE id=?',[inheriting])).rules_json).close,'18:20');
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE id=?',[overridden])).rules_json).close,'18:15');
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE id=?',[sid])).rules_json).close,'23:58');
});
test.after(()=>db().close());


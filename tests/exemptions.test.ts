import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {dateCN,addDays,defaultRules} from '../lib/domain';
import {exemptionFor,studentState,sessionStats} from '../lib/attendance';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/exemptions-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const realNow=Date.now;let now=Date.parse('2026-11-04T17:45:00+08:00');Date.now=()=>now;
const {ready,db,one,run,settings}=await import('../lib/db');
const {bootstrap,command,createSession}=await import('../lib/service');
await ready();
const admin={id:'admin',code:'admin',name:'虚构管理员',role:'admin'},a={id:'a',code:'A01',name:'虚构甲',role:'student'},b={id:'b',code:'B01',name:'虚构乙',role:'student'},c={id:'c',code:'C01',name:'虚构丙',role:'student'};
for(const u of [admin,a,b,c])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,now]);
const today=dateCN(now),tomorrow=addDays(today,1),past=addDays(today,-1),after=addDays(today,2);
const rule={...defaultRules,open:'17:30',close:'18:05',studyStart:'18:00',locationRequired:false,proofRequired:{personal:false}};
const session=await createSession(today,db(),rule),pastSession=await createSession(past,db(),rule),next=await createSession(tomorrow,db(),rule),later=await createSession(after,db(),rule);
const policy=(await settings()).policy;policy.notifications.enabled=false;await command(admin,{action:'policy.save',data:policy});
const create=(studentId='a',startsOn=today,endsOn:string|null=tomorrow)=>command(admin,{action:'exemption.create',data:{studentId,startsOn,endsOn,reason:'学校培训'}});
const end=(id:string)=>command(admin,{action:'exemption.end',data:{id}});
let exemptionId='';

test('默认正常打卡，只有管理员可设置免打卡；拒绝过去日期、非法日期、非学生和倒置时段',async()=>{
  assert.equal((await bootstrap(admin)).exemptions.length,0);
  assert.equal(studentState(await bootstrap(a),(await bootstrap(a)).sessions.find(s=>s.id===session),a.id).key,'waiting');
  for(const action of ['exemption.create','exemption.end'])await assert.rejects(command(a,{action,data:{}}),/权限/);
  for(const input of [[a.id,past,tomorrow],[a.id,today,past],[a.id,'2026-02-30',null],[admin.id,today,null],['missing',today,null]] as [string,string,string|null][])await assert.rejects(create(...input));
  assert.equal((await bootstrap(admin)).exemptions.length,0);
});
test('按日期免打卡且只影响本人，应参与人数和缺勤统计排除免打卡，待审申请保留但失效',async()=>{
  await command(a,{action:'leave.create',data:{sessionIds:[session,next],kind:'personal',reason:'虚构请假原因',proofIds:[]}});
  await run('INSERT INTO makeup_requests(id,user_id,session_id,reason,photo_ids,created_at,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,1)',['pending-a',a.id,session,'虚构补签','[]',now,JSON.stringify(rule)]);
  exemptionId=(await create()).id;
  const data=await bootstrap(admin),s=data.sessions.find(s=>s.id===session)!;data.now=Date.parse(today+'T20:00:00+08:00');
  assert.equal(studentState(data,s,a.id).key,'exempt');assert.equal(studentState(data,s,b.id).key,'absent');
  assert.deepEqual(sessionStats(data,s),{total:2,exempt:1,checked:0,leave:0,pending:0,makeup:0,waiting:0,absent:2});
  assert.equal(studentState(data,data.sessions.find(s=>s.id===pastSession),a.id).key,'absent');assert.equal(exemptionFor(data,a.id,after),undefined);
  assert.ok(data.leaves[0].items.every(i=>i.status==='invalid'));assert.equal(data.makeups[0].status,'invalid');assert.equal(data.checkins.length,0);
  assert.equal((await bootstrap(a)).exemptions.length,1);assert.equal((await bootstrap(b)).exemptions.length,0);
  assert.ok(data.logs.some(l=>l.action==='设置学生免打卡'));
});
test('免打卡不依赖页面限制，旧页面提交打卡、请假、补签和管理员补录均被后台拦截',async()=>{
  for(const [user,action,data] of [
    [a,'checkin',{sessionId:session}],
    [a,'leave.create',{sessionIds:[session],kind:'personal',reason:'虚构请假说明',proofIds:[]}],
    [a,'makeup.create',{sessionId:session,reason:'虚构现场说明',photoIds:['unused']}],
    [admin,'attendance.manual',{sessionId:session,studentId:a.id,reason:'已核实到场说明'}],
  ] as const)await assert.rejects(command(user,{action,data}),/免打卡/);
  assert.equal((await one('SELECT COUNT(*) n FROM checkins')).n,0);
});
test('时段两端均生效，重叠和并发重复拒绝，后生成场次与重复导入名单继续适用',async()=>{
  const result=await Promise.allSettled([create(c.id,today,null),create(c.id,today,null)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(create(a.id,tomorrow,after),/已有/);
  await command(admin,{action:'students.import',data:{students:[{code:a.code,name:'更正后的虚构甲'}]}});
  assert.equal((await one('SELECT id FROM users WHERE code=?',[a.code])).id,a.id);
  const far=await createSession(addDays(today,25),db(),rule),data=await bootstrap(admin);
  assert.ok(exemptionFor(data,a.id,today));assert.ok(exemptionFor(data,a.id,tomorrow));assert.equal(exemptionFor(data,a.id,after),undefined);
  assert.equal(studentState(data,data.sessions.find(s=>s.id===far),c.id).key,'exempt');
  assert.equal(sessionStats(data,{...data.sessions[0],cancelled:1}).total,0);
});
test('恢复打卡从当天生效，之前免打卡保留，恢复后可正常提交',async()=>{
  now=Date.parse(tomorrow+'T17:45:00+08:00');await end(exemptionId);
  const data=await bootstrap(admin);assert.equal(studentState(data,data.sessions.find(s=>s.id===session),a.id).key,'exempt');assert.equal(studentState(data,data.sessions.find(s=>s.id===next),a.id).key,'waiting');
  await command(a,{action:'checkin',data:{sessionId:next}});assert.equal((await one('SELECT COUNT(*) n FROM checkins WHERE user_id=?',[a.id])).n,1);
  await assert.rejects(end(exemptionId),/已结束/);
  now=Date.parse(today+'T17:45:00+08:00');
});
test('可提前预约和取消，取消当天生效的设置不留下缺勤豁免；结束日过后自然恢复',async()=>{
  const scheduled=await create(b.id,tomorrow,tomorrow);let data=await bootstrap(b);assert.equal(exemptionFor(data,b.id,today),undefined);assert.ok(exemptionFor(data,b.id,tomorrow));assert.equal(exemptionFor(data,b.id,after),undefined);
  await end(scheduled.id);data=await bootstrap(b);assert.equal(exemptionFor(data,b.id,tomorrow),undefined);assert.ok(data.exemptions[0].cancelled_at);
  const current=await create(b.id,today,today);await end(current.id);assert.equal(exemptionFor(await bootstrap(b),b.id,today),undefined);
});
test('已有打卡与获批请假保留原始状态，免打卡不伪造出勤',async()=>{
  await command(b,{action:'checkin',data:{sessionId:session}});
  const leave=await command(b,{action:'leave.create',data:{sessionIds:[next],kind:'personal',reason:'虚构已获批原因',proofIds:[]}});await command(admin,{action:'leave.review',data:{id:leave.id,decision:'approved',note:''}});
  await create(b.id,today,null);const data=await bootstrap(admin);
  assert.equal(studentState(data,data.sessions.find(s=>s.id===session),b.id).key,'checked');assert.equal(studentState(data,data.sessions.find(s=>s.id===next),b.id).key,'leave');assert.equal(studentState(data,data.sessions.find(s=>s.id===later),b.id).key,'exempt');
  assert.equal(data.checkins.filter(c=>c.user_id===b.id).length,1);assert.equal(data.leaves.find(l=>l.id===leave.id)?.items[0].status,'approved');
});
test('从旧结构升级不改动账号、名单、设置和考勤，重复启动保持免打卡记录',async()=>{
  const before=await bootstrap(admin),users=await db().execute('SELECT * FROM users');
  await run('UPDATE app_schema_version SET version=8 WHERE id=1');(globalThis as any).schemaReady=undefined;await ready();
  const after=await bootstrap(admin);assert.deepEqual(after.exemptions,before.exemptions);assert.deepEqual(after.checkins,before.checkins);assert.deepEqual(after.settings,before.settings);assert.deepEqual((await db().execute('SELECT * FROM users')).rows,users.rows);
  assert.equal((await one('SELECT version FROM app_schema_version WHERE id=1')).version,9);
});
test.after(()=>{Date.now=realNow;db().close();});

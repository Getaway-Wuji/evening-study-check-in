import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {dateCN,addDays,defaultRules} from '../lib/domain';
import {gcjToWgs} from '../lib/geofence';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/location-test-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,run,one,settings}=await import('../lib/db');
const {command,bootstrap,createSession}=await import('../lib/service');
const {locationTestContext,testStudentLocation}=await import('../lib/location-test');
await ready();
const admin={id:'admin',code:'owner',name:'管理员',role:'admin'},student={id:'student',code:'A001',name:'测试同学',role:'student'},other={id:'other',code:'A002',name:'其他同学',role:'student'};
for(const u of [admin,student,other])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
const today=dateCN(),clock=(time:string)=>Date.parse(`${today}T${time}+08:00`),before=clock('12:00:00');
const rules={...defaultRules,locationName:'已发布教室 A201',latitude:39.9,longitude:116.4,locationConfirmed:true,open:'17:30',close:'18:05',accuracyLimit:50,locationMaxAge:60};
const first=await createSession(today,db(),rules),repeated=await createSession(addDays(today,1),db(),rules),second=await createSession(addDays(today,2),db(),{...rules,locationName:'已发布教室 B302',latitude:39.91,radius:120});
const cancelled=await createSession(addDays(today,3),db(),{...rules,locationName:'已取消教室'}),unconfirmed=await createSession(addDays(today,4),db(),{...rules,locationName:'未核对教室',locationConfirmed:false});
await run('UPDATE sessions SET cancelled=1 WHERE id=?',[cancelled]);await run('DELETE FROM session_members WHERE session_id=? AND user_id=?',[first,other.id]);
const sample=(now=before)=>({sessionId:first,latitude:rules.latitude,longitude:rules.longitude,accuracy:10,capturedAt:now,coordinateSystem:'gcj02'});
async function toggle(enabled:boolean){const policy=(await settings()).policy;policy.locationTest.enabled=enabled;return command(admin,{action:'policy.save',data:policy});}

test('既有班级默认关闭定位测试，学生无法自己开放',async()=>{
  const ctx=await locationTestContext(student,before);assert.equal(ctx.enabled,false);assert.equal(ctx.available,false);assert.equal(ctx.targets.length,0);
  await assert.rejects(testStudentLocation(student,sample(),before),/未开放/);
  const policy=(await settings()).policy;policy.locationTest.enabled=true;await assert.rejects(command(student,{action:'policy.save',data:policy}),/权限/);
  assert.equal((await bootstrap(student)).settings.policy.locationTest.enabled,false);
});
test('管理员开启后只列本人已发布并核对的教室，重复场次合并',async()=>{
  await toggle(true);const ctx=await locationTestContext(student,before);
  assert.equal(ctx.available,true);assert.deepEqual(ctx.targets.map(t=>t.id),[first,second]);assert.ok(!ctx.targets.some(t=>[cancelled,unconfirmed,repeated].includes(t.id)));
  await assert.rejects(testStudentLocation(other,sample(),before),/不适用于/);
  await assert.rejects(locationTestContext(admin,before),/仅供学生/);
});
test('测试正常定位只返回验算结果，不生成任何签到、申请、邮件或位置日志',async()=>{
  const tables=['checkins','makeup_requests','leaves','files','email_jobs','audit_logs'],counts=await Promise.all(tables.map(t=>one(`SELECT COUNT(*) n FROM ${t}`)));
  const result=await testStudentLocation(student,sample(),before);assert.equal(result.eligible,true);assert.equal(result.inside,true);assert.equal(result.distance,0);assert.equal(result.recorded,false);
  for(let i=0;i<tables.length;i++)assert.equal((await one(`SELECT COUNT(*) n FROM ${tables[i]}`)).n,counts[i].n);
});
test('测试沿用正式定位的范围、精度与位置有效期，失败仍如实显示结果',async()=>{
  const outside=await testStudentLocation(student,{...sample(),latitude:39.91},before);assert.equal(outside.eligible,false);assert.equal(outside.inside,false);assert.match(outside.message,/超出/);
  const coarse=await testStudentLocation(student,{...sample(),accuracy:150},before);assert.equal(coarse.inside,true);assert.equal(coarse.eligible,false);assert.match(coarse.message,/精度不足/);
  const expired=await testStudentLocation(student,{...sample(),capturedAt:before-61000},before);assert.equal(expired.eligible,false);assert.match(expired.message,/过期/);
  const [latitude,longitude]=gcjToWgs(rules.latitude,rules.longitude),fresh={...sample(),latitude,longitude,coordinateSystem:'wgs84',timeBasis:'fresh-request',deviceTimestamp:10000};
  const compatible=await testStudentLocation(student,fresh,before);assert.equal(compatible.eligible,true);assert.equal(compatible.timeBasis,'fresh-request');assert.equal(compatible.recorded,false);
  assert.equal((await testStudentLocation(student,{...fresh,capturedAt:before-61000},before)).eligible,false);
  assert.equal((await testStudentLocation(student,{...fresh,deviceTimestamp:10001},before)).eligible,false);
  await assert.rejects(testStudentLocation(student,{...sample(),latitude:NaN},before));
});
test('正式打卡时段及截止分钟不开放测试，伪造请求时间也不能绕过',async()=>{
  for(const now of [clock('17:30:00'),clock('18:05:59.999')]){
    const ctx=await locationTestContext(student,now);assert.equal(ctx.available,false);assert.match(ctx.reason,/正式打卡时段/);
    await assert.rejects(testStudentLocation(student,{...sample(now),now:before},now),/正式打卡时段/);
  }
  for(const now of [clock('17:29:59.999'),clock('18:06:00')])assert.equal((await testStudentLocation(student,sample(now),now)).eligible,true);
});
test('测试结果不会解除正式签到的时间限制',async()=>{
  assert.equal((await testStudentLocation(student,sample(),before)).eligible,true);
  const realNow=Date.now;try{Date.now=()=>before;await assert.rejects(command(student,{action:'checkin',data:sample()}),/打卡时间/);}finally{Date.now=realNow;}
  assert.equal((await one('SELECT COUNT(*) n FROM checkins')).n,0);
});
test('管理员关闭后旧页面的测试请求也被拒绝，历史业务数据保留',async()=>{
  const old=await locationTestContext(student,before);assert.equal(old.available,true);await toggle(false);
  await assert.rejects(testStudentLocation(student,sample(),before),/未开放/);assert.equal((await bootstrap(student)).settings.policy.locationTest.enabled,false);
  assert.equal((await one('SELECT COUNT(*) n FROM sessions')).n,5);assert.equal((await one('SELECT COUNT(*) n FROM users')).n,3);
});
test('没有适用场次或地点撤回核对时不能测试',async()=>{
  await toggle(true);await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',['unassigned','A003','未分配同学','student',Date.now()]);
  const ctx=await locationTestContext({id:'unassigned',role:'student'},before);assert.equal(ctx.available,false);assert.equal(ctx.targets.length,0);
  await run('UPDATE sessions SET rules_json=? WHERE id IN (?,?)',[JSON.stringify({...rules,locationConfirmed:false}),first,repeated]);
  await assert.rejects(testStudentLocation(student,sample(),before),/已更新或不适用于/);
});
test.after(()=>db().close());

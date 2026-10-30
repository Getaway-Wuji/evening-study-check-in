import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {defaultRules,dateCN,addDays} from '../lib/domain';
import {semesterDate,semesterWeek,rangesOverlap} from '../lib/timetable-domain';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/timetable-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,run,one,rows,db}=await import('../lib/db');
const {command,bootstrap,createSession}=await import('../lib/service');
const {previewTerm}=await import('../lib/timetable');
await ready();
const admin={id:'admin',role:'admin',code:'teacher',name:'测试管理员'},student={id:'student',role:'student',code:'01',name:'测试同学'};
for(const u of [admin,student])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
const today=dateCN(),weekday=new Date(today).getUTCDay(),monday=addDays(today,(8-weekday)%7||7);
let termId='',previewRevision=0;
const ids:Record<string,string>={};
const room=(name:string)=>({...defaultRules,latitude:39.9,longitude:116.4,locationName:name,locationConfirmed:true});
test('周次从周一开始，周日是同一周最后一天',()=>{
  assert.equal(semesterDate('2026-09-07',1,2),'2026-09-08');assert.equal(semesterDate('2026-09-07',1,0),'2026-09-13');assert.equal(semesterDate('2026-09-07',2,0),'2026-09-20');
  assert.equal(semesterWeek({firstMonday:'2026-09-07',totalWeeks:20},'2026-09-13'),1);assert.equal(semesterWeek({firstMonday:'2026-09-07',totalWeeks:20},'2026-09-14'),2);
  assert.throws(()=>semesterDate('2026-09-08',1,2),/周一/);
  assert.equal(rangesOverlap({weekday:2,startWeek:1,endWeek:8},{weekday:2,startWeek:9,endWeek:20}),false);
  assert.equal(rangesOverlap({weekday:2,startWeek:1,endWeek:8},{weekday:2,startWeek:8,endWeek:20}),true);
});
test('每周日二三可分别按周次配置教室',async()=>{
  termId=(await command(admin,{action:'term.save',data:{name:'周期规则测试学期',firstMonday:monday,totalWeeks:20,weekdays:[0,2,3]}})).id;
  for(const [key,weekday,startWeek,endWeek,inheritTime] of [['sun',0,1,20,true],['tue-a',2,1,8,true],['tue-b',2,9,20,true],['wed-a',3,1,10,true],['wed-b',3,11,20,false]] as const){
    ids[key]=(await command(admin,{action:'recurrence.save',data:{termId,weekday,startWeek,endWeek,inheritTime,rules:{...room(key),...(inheritTime?{}:{open:'17:00',close:'18:15'})}}})).id;
  }
  assert.equal((await one('SELECT COUNT(*) n FROM recurring_rules')).n,5);
});
test('拒绝同星期周次重叠和超出学期范围',async()=>{
  await assert.rejects(command(admin,{action:'recurrence.save',data:{termId,weekday:2,startWeek:8,endWeek:10,rules:room('重叠')}}),/重叠/);
  await assert.rejects(command(admin,{action:'recurrence.save',data:{termId,weekday:2,startWeek:21,endWeek:22,rules:room('越界')}}),/周次应/);
  assert.equal((await one('SELECT COUNT(*) n FROM recurring_rules')).n,5);
});
test('预览准确映射换教室边界，且不会提前修改实际安排',async()=>{
  const p=(await command(admin,{action:'term.preview',data:{id:termId}})).plan;previewRevision=p.revision;
  assert.equal(p.counts.create,60);assert.equal(p.gaps.length,0);assert.equal(p.errors.length,0);
  assert.equal(p.entries.find((e:any)=>e.date===semesterDate(monday,8,2)).location,'tue-a');
  assert.equal(p.entries.find((e:any)=>e.date===semesterDate(monday,9,2)).location,'tue-b');
  assert.equal(p.entries.find((e:any)=>e.date===semesterDate(monday,11,3)).location,'wed-b');
  assert.equal((await one('SELECT COUNT(*) n FROM sessions')).n,0);
});
test('发布生成真实日期并保留已有单日调整，成员名单正确',async()=>{
  const date=semesterDate(monday,2,2);
  await command(admin,{action:'session.save',data:{date,rules:{...room('临时教室'),close:'18:25'},reason:'测试单日调整',cancelled:false}});
  const p=await previewTerm(termId,db());assert.equal(p.counts.protected,1);assert.equal(p.counts.create,59);
  await command(admin,{action:'term.publish',data:{id:termId,revision:p.revision}});
  assert.equal((await one('SELECT COUNT(*) n FROM sessions')).n,60);assert.equal((await one('SELECT COUNT(*) n FROM session_members')).n,60);
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[date])).rules_json).locationName,'临时教室');
});
test('默认时间更新不会覆盖分周教室、独立时间和临时调整',async()=>{
  await command(admin,{action:'defaults.save',data:{effectiveFrom:monday,rules:{...room('默认模板'),close:'18:10'}}});
  const a=JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[semesterDate(monday,9,2)])).rules_json);assert.equal(a.locationName,'tue-b');assert.equal(a.close,'18:10');
  const b=JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[semesterDate(monday,11,3)])).rules_json);assert.equal(b.locationName,'wed-b');assert.equal(b.close,'18:15');
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[semesterDate(monday,2,2)])).rules_json).close,'18:25');
});
test('恢复单日规则会回到对应周次的教室，修改草稿不提前生效',async()=>{
  const date=semesterDate(monday,2,2);
  await command(admin,{action:'session.save',data:{date,rules:room('无关模板'),restore:true,reason:'恢复周期规则'}});
  const restored=JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[date])).rules_json);assert.equal(restored.locationName,'tue-a');assert.equal(restored.close,'18:10');
  await command(admin,{action:'recurrence.save',data:{id:ids['tue-b'],termId,weekday:2,startWeek:9,endWeek:20,inheritTime:true,rules:room('更换后的教室')}});
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[semesterDate(monday,9,2)])).rules_json).locationName,'tue-b');
  await assert.rejects(command(admin,{action:'term.publish',data:{id:termId,revision:previewRevision}}),/重新预览/);
  const p=await previewTerm(termId,db());await command(admin,{action:'term.publish',data:{id:termId,revision:p.revision}});
  assert.equal(JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[semesterDate(monday,9,2)])).rules_json).locationName,'更换后的教室');
});
test('停用周次需要确认缺失日期，已发布学期起点受保护',async()=>{
  await assert.rejects(command(admin,{action:'term.save',data:{id:termId,name:'错误修改',firstMonday:addDays(monday,7),totalWeeks:20,weekdays:[0,2,3]}}),/历史周次/);
  await command(admin,{action:'recurrence.toggle',data:{id:ids['wed-b'],enabled:false}});
  const p=await previewTerm(termId,db());assert.equal(p.counts.cancel,10);assert.equal(p.gaps.length,10);
  await assert.rejects(command(admin,{action:'term.publish',data:{id:termId,revision:p.revision}}),/未配置教室/);
  await command(admin,{action:'term.publish',data:{id:termId,revision:p.revision,allowGaps:true}});
  assert.equal((await one('SELECT COUNT(*) n FROM sessions WHERE cancelled=1')).n,10);
});
test('未核对的定位点不能发布，学生无法访问后台草稿',async()=>{
  await command(admin,{action:'recurrence.save',data:{id:ids['wed-b'],termId,weekday:3,startWeek:11,endWeek:20,enabled:true,rules:{...room('待核对教室'),locationConfirmed:false}}});
  const p=await previewTerm(termId,db());assert.ok(p.errors.length>0);
  await assert.rejects(command(admin,{action:'term.publish',data:{id:termId,revision:p.revision}}),/定位点尚未核对/);
  const data=await bootstrap(student);assert.equal(data.recurring.length,0);
  await assert.rejects(command(student,{action:'term.save',data:{}}),/权限/);
});
test('默认只接受姓名身份和定位，未启用的附加内容会被拒绝',async()=>{
  const current={...room('今日地点'),open:'00:00',close:'23:59'};
  const sid=await createSession(today,db(),current),location={latitude:current.latitude,longitude:current.longitude,accuracy:10,capturedAt:Date.now(),coordinateSystem:'gcj02'};
  await assert.rejects(command(student,{action:'checkin',data:{sessionId:sid,...location,note:'未要求的备注'}}),/没有启用备注/);
  await assert.rejects(command(student,{action:'checkin',data:{sessionId:sid,...location,photoIds:['unrequested']}}),/没有启用照片/);
  assert.ok((await command(student,{action:'checkin',data:{sessionId:sid,...location}})).id);
});
test('已开始日期在周次预览中锁定，不能被整体重新生成',async()=>{
  const p=await previewTerm(termId,db(),Date.parse(semesterDate(monday,3,3)+'T19:00:00+08:00'));
  assert.equal(p.counts.locked,8);assert.equal(p.entries.find(e=>e.date===semesterDate(monday,1,2))?.action,'locked');
});
test.after(()=>db().close());

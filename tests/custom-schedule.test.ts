import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {dateCN,addDays,period,type Rules} from '../lib/domain';
import {semesterDate} from '../lib/timetable-domain';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/custom-schedule-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {initializeClass}=await import('../lib/setup');
const {db,one,rulesFor}=await import('../lib/db');
const {command}=await import('../lib/service');
const studyTimes={open:'19:10',studyStart:'19:45',close:'20:00'};
const credentials={className:'自定义时间测试班',username:'schedule_owner',password:'Custom-schedule-'+crypto.randomUUID()};
const today=dateCN(),day=new Date(today).getUTCDay(),monday=addDays(today,(8-day)%7||7);
let admin:any,termId='';
const saved=async(date:string):Promise<Rules>=>JSON.parse((await one('SELECT rules_json FROM sessions WHERE date=?',[date])).rules_json);

test('新班级保存自己的三个时间，非法时间不会创建管理员',async()=>{
  for(const invalid of [{...studyTimes,open:'20:01'},{...studyTimes,close:'24:00'},{...studyTimes,studyStart:''}])await assert.rejects(initializeClass({...credentials,studyTimes:invalid}));
  const {id}=await initializeClass({...credentials,studyTimes});admin=await one('SELECT * FROM users WHERE id=?',[id]);
  const rules=await rulesFor(monday);for(const key of ['open','studyStart','close'] as const)assert.equal(rules[key],studyTimes[key]);
});
test('每周星期和周次时间可独立设置，学生场次采用已保存的规则',async()=>{
  termId=(await command(admin,{action:'term.save',data:{name:'自定义星期',firstMonday:monday,totalWeeks:2,weekdays:[1,4,6]}})).id;
  for(const weekday of [1,4,6])await command(admin,{action:'recurrence.save',data:{termId,weekday,startWeek:1,endWeek:2,inheritTime:weekday!==6,rules:{...await rulesFor(monday),locationRequired:false,...(weekday===6?{open:'20:10',studyStart:'20:30',close:'20:45'}:{})}}});
  const plan=(await command(admin,{action:'term.preview',data:{id:termId}})).plan;
  assert.deepEqual([...new Set(plan.entries.map((e:any)=>e.weekday))],[1,4,6]);assert.equal(plan.counts.create,6);
  await command(admin,{action:'term.publish',data:{id:termId,revision:plan.revision}});
  assert.equal((await saved(monday)).open,'19:10');assert.equal((await saved(semesterDate(monday,1,6))).close,'20:45');
  const rules=await saved(monday),at=(time:string)=>Date.parse(monday+'T'+time+'+08:00');
  assert.equal(period(monday,rules,at('19:09:59')),'before');assert.equal(period(monday,rules,at('19:10:00')),'open');
  assert.equal(period(monday,rules,at('20:00:59')),'open');assert.equal(period(monday,rules,at('20:01:00')),'closed');
});
test('修改默认时间只更新沿用它的场次，单日时间和独立周次时间继续保留',async()=>{
  const thursday=semesterDate(monday,1,4),saturday=semesterDate(monday,1,6);
  await command(admin,{action:'session.save',data:{date:thursday,rules:{...await saved(thursday),open:'21:00',studyStart:'21:15',close:'21:30'},reason:'独立单日时间'}});
  await command(admin,{action:'defaults.save',data:{effectiveFrom:monday,rules:{...await rulesFor(monday),open:'18:40',studyStart:'19:00',close:'19:20'}}});
  const inherited=await saved(monday);assert.equal(inherited.open,'18:40');assert.equal(inherited.studyStart,'19:00');assert.equal(inherited.close,'19:20');
  assert.equal((await saved(thursday)).close,'21:30');assert.equal((await saved(saturday)).close,'20:45');
});
test('管理员修改每周星期会保存天数并停用移除规则，预览发布前不影响学生场次',async()=>{
  const current=await one('SELECT revision FROM academic_terms WHERE id=?',[termId]);
  await command(admin,{action:'term.weekdays',data:{id:termId,revision:current.revision,weekdays:[4,1]}});
  const term=await one('SELECT * FROM academic_terms WHERE id=?',[termId]);
  assert.deepEqual(JSON.parse(term.weekdays_json),[1,4]);
  assert.equal(term.revision,current.revision+1);
  assert.equal((await one('SELECT enabled FROM recurring_rules WHERE term_id=? AND weekday=6',[termId])).enabled,0);
  const saturday=semesterDate(monday,1,6),thursday=semesterDate(monday,1,4);
  assert.equal((await one('SELECT cancelled FROM sessions WHERE date=?',[saturday])).cancelled,0);
  const plan=(await command(admin,{action:'term.preview',data:{id:termId}})).plan;
  assert.equal(plan.counts.cancel,2);assert.equal(plan.counts.protected,1);
  await command(admin,{action:'term.publish',data:{id:termId,revision:plan.revision}});
  assert.equal((await one('SELECT cancelled FROM sessions WHERE date=?',[saturday])).cancelled,1);
  assert.equal((await saved(thursday)).close,'21:30');
  assert.equal((await one('SELECT cancelled FROM sessions WHERE date=?',[monday])).cancelled,0);
});
test('星期设置支持每周七天，拒绝空选、重复、过期版本及学生修改',async()=>{
  const input={id:termId,revision:(await one('SELECT revision FROM academic_terms WHERE id=?',[termId])).revision};
  await assert.rejects(command(admin,{action:'term.weekdays',data:{...input,weekdays:[]}}));
  await assert.rejects(command(admin,{action:'term.weekdays',data:{...input,weekdays:[1,1]}}));
  await assert.rejects(command(admin,{action:'term.weekdays',data:{...input,weekdays:[7]}}));
  await assert.rejects(command({id:'student',role:'student'} as any,{action:'term.weekdays',data:{...input,weekdays:[1]}}),/权限/);
  await command(admin,{action:'term.weekdays',data:{...input,weekdays:[0,6,5,4,3,2,1]}});
  assert.deepEqual(JSON.parse((await one('SELECT weekdays_json FROM academic_terms WHERE id=?',[termId])).weekdays_json),[1,2,3,4,5,6,0]);
  await assert.rejects(command(admin,{action:'term.weekdays',data:{...input,weekdays:[2]}}),/已发生变化/);
  // Re-selecting a removed day retains its old rules as disabled until the administrator enables them.
  assert.equal((await one('SELECT enabled FROM recurring_rules WHERE term_id=? AND weekday=6',[termId])).enabled,0);
});
test.after(()=>db().close());

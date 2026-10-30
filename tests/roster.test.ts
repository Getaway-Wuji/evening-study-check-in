import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/roster-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,one,run,settings,transaction}=await import('../lib/db');
const {initializeClass}=await import('../lib/setup');
const {command,bootstrap,createSession}=await import('../lib/service');
const {defaultRules,dateCN,addDays}=await import('../lib/domain');
await ready();
let admin:any,past='',open='',future='';
const list=(prefix:string,n:number)=>Array.from({length:n},(_,i)=>({code:prefix+String(i+1).padStart(4,'0'),name:'测试同学 '+(i+1)}));
const save=(capacity?:number|null)=>command(admin,{action:'settings.save',data:{className:'自定义人数测试班',adminEmails:[],locationConfigured:false,...(capacity===undefined?{}:{capacity})}});
const size=async()=>Number((await one("SELECT COUNT(*) n FROM users WHERE role='student'")).n);
test('新部署人数不写死，初始化可设置人数上限且不创建虚构学生',async()=>{
  assert.equal((await settings()).capacity,null);
  const {id}=await initializeClass({className:'自定义人数测试班',capacity:55,username:'rosteradmin',password:'Roster-test-'+crypto.randomUUID()});
  admin=await one('SELECT * FROM users WHERE id=?',[id]);assert.equal((await settings()).capacity,55);assert.equal(await size(),0);
  await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...await settings(),capacity:39})]);
  await save();assert.equal((await settings()).capacity,39,'旧客户端省略人数字段时保留已有配置');await save(55);
  await transaction(async tx=>{past=await createSession(addDays(dateCN(),-1),tx);open=await createSession(dateCN(),tx,{...defaultRules,open:'00:00',close:'23:59'});future=await createSession(addDays(dateCN(),2),tx);});
});
test('超过原有人数也能批量导入，人数自动统计且只补入尚未开始的场次',async()=>{
  await command(admin,{action:'students.import',data:{students:list('S',45)}});assert.equal(await size(),45);
  assert.equal((await bootstrap(admin)).studentCount,45);
  assert.equal((await one('SELECT COUNT(*) n FROM session_members WHERE session_id=?',[future])).n,45);
  assert.equal((await one('SELECT COUNT(*) n FROM session_members WHERE session_id IN (?,?)',[past,open])).n,0);
});
test('重复导入更新姓名，保留身份、账号和场次名单；重复学号或管理员冲突整体拒绝',async()=>{
  const student=await one("SELECT * FROM users WHERE code='S0001'");await run("UPDATE users SET password_hash='existing-test-account' WHERE id=?",[student.id]);
  await command(admin,{action:'students.import',data:{students:[{code:'S0001',name:'已更正姓名'}]}});
  const updated=await one("SELECT * FROM users WHERE code='S0001'");assert.equal(updated.id,student.id);assert.equal(updated.password_hash,'existing-test-account');assert.equal(await size(),45);
  assert.equal((await one('SELECT COUNT(*) n FROM session_members WHERE session_id=?',[future])).n,45);
  await assert.rejects(command(admin,{action:'students.import',data:{students:[{code:'DUP',name:'甲'},{code:'ＤＵＰ',name:'乙'}]}}),/重复/);
  await assert.rejects(command(admin,{action:'students.import',data:{students:[{code:'S0001',name:'不应写入'},{code:'rosteradmin',name:'冲突'}]}}),/管理员/);
  assert.equal((await one('SELECT name FROM users WHERE id=?',[student.id])).name,'已更正姓名');
});
test('人数上限由后台控制，超额导入及低于现有名册的调整不会留下部分更新',async()=>{
  await assert.rejects(command(admin,{action:'students.import',data:{students:[{code:'S0001',name:'不应写入'},...list('OVER',11)]}}),/55 人上限/);
  assert.equal(await size(),45);assert.equal((await one("SELECT name FROM users WHERE code='S0001'")).name,'已更正姓名');
  for(const invalid of [44,0,-1,1.5])await assert.rejects(save(invalid));
  assert.equal((await settings()).capacity,55);
});
test('并发导入共同遵守当前班级上限',async()=>{
  const results=await Promise.allSettled([command(admin,{action:'students.import',data:{students:list('A',6)}}),command(admin,{action:'students.import',data:{students:list('B',6)}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await size(),51);
  assert.equal((await one('SELECT COUNT(*) n FROM session_members WHERE session_id=?',[future])).n,51);
});
test('留空取消人数上限，较大批次正常导入；学生仅能看到本人名单和班级总人数',async()=>{
  await save(null);await command(admin,{action:'students.import',data:{students:list('L',205)}});assert.equal(await size(),256);
  assert.equal((await one('SELECT COUNT(*) n FROM session_members WHERE session_id=?',[future])).n,256);
  const student=await one("SELECT * FROM users WHERE code='S0001'"),data=await bootstrap(student);
  assert.equal(data.studentCount,256);assert.equal(data.students.length,1);assert.equal(data.students[0].id,student.id);assert.equal(data.settings.capacity,null);assert.equal(data.settings.adminEmails,undefined);
  await assert.rejects(save(255));await assert.rejects(command(student,{action:'settings.save',data:{capacity:999}}),/权限/);
  await assert.rejects(command(admin,{action:'students.import',data:{students:list('TOO',1001)}}),/1000/);assert.equal(await size(),256);
});
test.after(()=>db().close());

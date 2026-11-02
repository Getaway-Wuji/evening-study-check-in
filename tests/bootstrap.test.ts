import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/bootstrap-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,run,one,settings}=await import('../lib/db');
const {bootstrap,createSession}=await import('../lib/service');
const {dateCN,addDays}=await import('../lib/domain');
await ready();
const admin={id:'admin',code:'admin',name:'虚构管理员',role:'admin'},student={id:'student',code:'S01',name:'虚构学生',role:'student'},other={id:'other',code:'S02',name:'其他学生',role:'student'};
for(const u of [admin,student,other])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
const mine=await createSession(dateCN(),db()),others=await createSession(addDays(dateCN(),1),db());
await run('DELETE FROM session_members WHERE session_id=? AND user_id=?',[others,student.id]);
await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...await settings(),className:'保留班级设置',adminEmails:['private@example.test']})]);
for(const u of [student,other]){
 await run('INSERT INTO leaves(id,user_id,kind,reason,proof_ids,created_at) VALUES(?,?,?,?,?,?)',['leave-'+u.id,u.id,'personal',u.id==='other'?'other-private-reason':'my-reason','[]',Date.now()]);
 await run('INSERT INTO leave_items(id,leave_id,user_id,session_id,status) VALUES(?,?,?,?,?)',['item-'+u.id,'leave-'+u.id,u.id,mine,'pending']);
 await run("INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,'image/png',1,?,1,'proof',?)",['file-'+u.id,u.id,u.id==='other'?'other-private-file':'my-file','fixture-'+u.id,Date.now()]);
}

test('批量首屏读取保持角色隔离，学生不收到其他学生明细、后台草稿和管理员邮箱',async()=>{
 const mineData=await bootstrap(student);assert.equal(mineData.studentCount,2);assert.deepEqual(mineData.students.map(u=>u.id),[student.id]);assert.deepEqual(mineData.sessions.map(s=>s.id),[mine]);
 assert.ok(mineData.members.every(m=>m.user_id===student.id));assert.equal(mineData.leaves.length,1);assert.equal(mineData.leaves[0].items.length,1);assert.equal(mineData.files.length,1);assert.equal(mineData.recurring.length,0);assert.equal(mineData.jobs.length,0);assert.equal(mineData.logs.length,0);assert.equal(mineData.integrations,undefined);
 assert.ok(!/other-private|private@example.test|password_hash|token_hash/.test(JSON.stringify(mineData)));
 const adminData=await bootstrap(admin);assert.equal(adminData.studentCount,2);assert.equal(adminData.students.length,2);assert.equal(adminData.leaves.length,2);assert.equal(adminData.files.length,2);assert.equal(adminData.sessions.length,2);assert.deepEqual(adminData.settings.adminEmails,['private@example.test']);
});

test('首屏读取不缓存业务数据，规则和记录更新后下一次读取立即可见',async()=>{
 const first=await bootstrap(student);await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...await settings(),className:'刚更新的班级名称'})]);
 const second=await bootstrap(student);assert.equal(first.settings.className,'保留班级设置');assert.equal(second.settings.className,'刚更新的班级名称');
 await run("UPDATE leave_items SET status='approved' WHERE user_id=?",[student.id]);assert.equal((await bootstrap(student)).leaves[0].items[0].status,'approved');
});

test('新实例仅检查持久化结构版本，不重做建表与初始化，不覆盖业务数据',async()=>{
 const before=await settings();assert.equal((await one('PRAGMA user_version')).user_version,7);
 const globalState=globalThis as unknown as {schemaReady?:Promise<void>},c=db(),original=c.executeMultiple.bind(c);let setupCalls=0;
 c.executeMultiple=async sql=>{assert.ok(!/CREATE|ALTER|INSERT|UPDATE|DELETE/i.test(sql));setupCalls++;return original(sql);};globalState.schemaReady=undefined;
 try{await ready();assert.equal(setupCalls,1);assert.deepEqual(await settings(),before);assert.equal((await one('SELECT COUNT(*) n FROM users')).n,3);}finally{c.executeMultiple=original;}
});

test('迁移失败不提前标记完成，后续可以重试，已有名单和设置保留',async()=>{
 await run('PRAGMA user_version=6');const globalState=globalThis as unknown as {schemaReady?:Promise<void>},c=db(),original=c.executeMultiple.bind(c);
 c.executeMultiple=async sql=>{if(sql.includes('CREATE TABLE'))throw Error('fixture migration failure');return original(sql);};globalState.schemaReady=undefined;
 try{await assert.rejects(ready(),/fixture migration failure/);assert.equal((await one('PRAGMA user_version')).user_version,6);}finally{c.executeMultiple=original;}
 await ready();assert.equal((await one('PRAGMA user_version')).user_version,7);assert.equal((await settings()).className,'刚更新的班级名称');assert.equal((await one('SELECT COUNT(*) n FROM users')).n,3);
});
test.after(()=>db().close());

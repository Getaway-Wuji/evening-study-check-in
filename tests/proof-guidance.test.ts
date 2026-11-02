import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {dateCN,addDays,defaultRules} from '../lib/domain';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/proof-guidance-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,one,run,settings}=await import('../lib/db');
const {command,bootstrap,createSession}=await import('../lib/service');
await ready();
const admin={id:'admin',code:'A01',name:'虚构管理员',role:'admin'},student={id:'student',code:'S01',name:'虚构学生',role:'student'};
for(const u of [admin,student])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
const save=(text:unknown)=>command(admin,{action:'settings.proofGuidance.save',data:{text}});

test('旧站默认不显示提示，管理员独立保存后学生能读取换行文字，其他设置保留',async()=>{
  const previous=await settings();assert.equal(previous.leaveProofGuidance,'');
  const text='请同时上传：\n1. 已向辅导员说明请假情况的聊天截图。\n2. 请假说明图片。';
  await save('  '+text+'  ');assert.equal((await settings()).leaveProofGuidance,text);assert.equal((await bootstrap(student)).settings.leaveProofGuidance,text);
  assert.deepEqual({...await settings(),leaveProofGuidance:''},previous);assert.equal((await one('SELECT COUNT(*) n FROM leaves')).n,0);assert.equal((await one('SELECT COUNT(*) n FROM email_jobs')).n,0);
});

test('学生不能修改提示，非法或超长内容不会覆盖已保存内容，留空可关闭',async()=>{
  const previous=(await settings()).leaveProofGuidance;
  await assert.rejects(command(student,{action:'settings.proofGuidance.save',data:{text:'不能更改'}}),/权限/);await assert.rejects(save('字'.repeat(2001)));await assert.rejects(save({text:'invalid'}));
  assert.equal((await settings()).leaveProofGuidance,previous);await save(' \n ');assert.equal((await bootstrap(student)).settings.leaveProofGuidance,'');
});

test('上传提示不改变现有必交、选交校验，单独保存业务规则也不会清除提示',async()=>{
  const policy=(await settings()).policy;policy.notifications.enabled=false;await save('请同时上传辅导员沟通截图和请假说明图片。');await command(admin,{action:'policy.save',data:policy});
  assert.ok((await settings()).leaveProofGuidance?.includes('辅导员'));
  const optional=await createSession(addDays(dateCN(),1),db(),{...defaultRules,proofRequired:{personal:false}}),required=await createSession(addDays(dateCN(),2),db(),{...defaultRules,proofRequired:{personal:true}});
  const apply=(id:string,proofIds:string[]=[])=>command(student,{action:'leave.create',data:{sessionIds:[id],kind:'personal',reason:'虚构请假说明',proofIds}});
  assert.ok((await apply(optional)).id);await assert.rejects(apply(required),/证明/);
  await run("INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES('proof','student','虚构图片','image/png',100,'fixture-proof',1,'proof',?)",[Date.now()]);
  assert.ok((await apply(required,['proof'])).id);
});
test.after(()=>db().close());

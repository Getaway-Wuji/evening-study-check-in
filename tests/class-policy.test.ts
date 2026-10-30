import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {defaultRules,dateCN,addDays} from '../lib/domain';
import {defaultClassPolicy,leaveDeadline,needsLeaveProof,leaveLabel,uploadLimits} from '../lib/class-policy';
import {checkFile} from '../lib/files';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/policy-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,one,run,settings}=await import('../lib/db');
const {command,bootstrap,createSession}=await import('../lib/service');
const {processMailJobs}=await import('../lib/mail');
await ready();
const admin={id:'admin',code:'owner',name:'管理员',role:'admin'},student={id:'student',code:'S001',name:'测试同学',role:'student'};
for(const u of [admin,student])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[u.id,u.code,u.name,u.role,Date.now()]);
const today=dateCN(),future=addDays(today,3),type={id:'school_activity',name:'校内活动',enabled:true,reasonRequired:false,proofRequired:false};
let firstLeave='',sessionIndex=0;
const save=(policy:any)=>command(admin,{action:'policy.save',data:policy});
const session=()=>createSession(addDays(future,sessionIndex++),db(),{...defaultRules,locationRequired:false,noteEnabled:true});
const apply=(sessionIds:string[],extras:Record<string,unknown>={})=>command(student,{action:'leave.create',data:{sessionIds,kind:type.id,reason:'',proofIds:[],...extras}});

test('旧班级自动获得兼容规则，已有名称、人数和单场证明要求保留',async()=>{
  await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({className:'原来的班级',capacity:39,adminEmails:[],locationConfigured:false})]);
  assert.equal((await settings()).capacity,39);assert.deepEqual((await settings()).policy,defaultClassPolicy);
  const isolated=(await settings()).policy;isolated.notifications.retryMinutes[0]=99;assert.equal((await settings()).policy.notifications.retryMinutes[0],1);
  assert.equal(needsLeaveProof(defaultRules,{...type,id:'sick',proofRequired:false}),true);
  const policy=(await settings()).policy;policy.leaveTypes.push(type);await save(policy);
  assert.equal((await bootstrap(student)).settings.adminEmails,undefined);
  assert.equal((await bootstrap(student)).settings.policy.leaveTypes.at(-1)?.name,type.name);
});
test('新类型可以提交；改名、停用后，已有申请保留提交时名称',async()=>{
  const result=await apply([await session()]);firstLeave=result.id;
  assert.equal((await one('SELECT kind_label FROM leaves WHERE id=?',[firstLeave])).kind_label,'校内活动');
  const policy=(await settings()).policy;policy.leaveTypes.find(t=>t.id===type.id)!.name='活动外出';policy.leaveTypes.find(t=>t.id===type.id)!.enabled=false;await save(policy);
  assert.equal((await bootstrap(student)).leaves.find(l=>l.id===firstLeave)?.kindLabel,'校内活动');
  await assert.rejects(apply([await session()]),/停用/);
  assert.equal(leaveLabel({kind:'sick'},policy),'病假');
  policy.leaveTypes.find(t=>t.id===type.id)!.enabled=true;await save(policy);
});
test('类型默认要求、原因字数和单次场数在服务端校验且失败整体回滚',async()=>{
  const policy=(await settings()).policy;policy.leave.maxSessions=1;policy.leave.reasonMinLength=8;policy.leaveTypes.find(t=>t.id===type.id)!.proofRequired=true;await save(policy);
  const sid=await session();await assert.rejects(apply([sid]),/证明/);
  await assert.rejects(apply([sid],{kind:'personal',reason:'太短'}),/至少填写 8 字/);
  await assert.rejects(apply([sid,await session()]));
  assert.equal((await one('SELECT COUNT(*) n FROM leaves')).n,1);
  assert.equal((await one('SELECT COUNT(*) n FROM email_jobs')).n,1);
});
test('请假截止可选不同基准和提前分钟，边界与服务器规则一致',async()=>{
  const policy=(await settings()).policy;policy.leave.deadline='studyStart';policy.leave.advanceMinutes=30;
  assert.equal(leaveDeadline(future,defaultRules,policy),Date.parse(future+'T17:30:00+08:00'));
  policy.leave.deadline='close';policy.leave.advanceMinutes=0;
  assert.equal(leaveDeadline(future,defaultRules,policy),Date.parse(future+'T18:06:00+08:00'));
  policy.leave.deadline='open';policy.leaveTypes.find(t=>t.id===type.id)!.proofRequired=false;await save(policy);
  const sid=await createSession(today,db(),{...defaultRules,open:'00:00',close:'23:59',locationRequired:false,noteEnabled:true});
  await assert.rejects(apply([sid]),/请假截止时间/);
});
test('数量、大小和 PDF 开关不能通过旧附件绕过；已提交附件仍可保留',async()=>{
  const policy=(await settings()).policy;policy.uploads.proofMaxFiles=1;policy.uploads.proofMaxMB=1;policy.uploads.proofPdfEnabled=false;await save(policy);
  for(const [id,mime,size] of [['png-a','image/png',100],['png-b','image/png',100],['large','image/png',2*1024*1024],['pdf','application/pdf',100]] as const)await run("INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,'student',?,?,?, ?,1,'proof',?)",[id,id,mime,size,id,Date.now()]);
  const sid=await session();await assert.rejects(apply([sid],{proofIds:['png-a','png-b']}));
  await assert.rejects(apply([sid],{proofIds:['large']}),/1 MB/);await assert.rejects(apply([sid],{proofIds:['pdf']}),/只接受/);
  assert.ok((await apply([sid],{proofIds:['png-a']})).id);
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);checkFile(bytes,'image/png','proof',uploadLimits(policy,'proof'));
  assert.throws(()=>checkFile(new Uint8Array(Buffer.from('%PDF-test')),'application/pdf','proof',uploadLimits(policy,'proof')),/未启用/);
});
test('打卡备注长度遵守后台设置，旧版固定星期生成入口停用',async()=>{
  const policy=(await settings()).policy;policy.noteMaxLength=4;await save(policy);
  const sid=(await one('SELECT id FROM sessions WHERE date=?',[today])).id;
  await assert.rejects(command(student,{action:'checkin',data:{sessionId:sid,note:'超过四字了'}}));
  assert.ok((await command(student,{action:'checkin',data:{sessionId:sid,note:'四个文字'}})).id);
  await assert.rejects(command(admin,{action:'sessions.generate',data:{from:today,to:future}}),/旧版固定星期/);
});
test('关闭通知时申请正常保存且不建邮件任务；开启后按自设次数和间隔重试',async()=>{
  const policy=(await settings()).policy;policy.notifications={enabled:false,maxAttempts:2,retryMinutes:[2]};await save(policy);
  const before=Number((await one('SELECT COUNT(*) n FROM email_jobs')).n);assert.equal((await apply([await session()])).mailJob,false);assert.equal((await one('SELECT COUNT(*) n FROM email_jobs')).n,before);
  await run("UPDATE email_jobs SET status='accepted'");policy.notifications.enabled=true;await save(policy);
  const result=await apply([await session()]),job=await one('SELECT * FROM email_jobs WHERE leave_id=?',[result.id]);
  await command(admin,{action:'settings.save',data:{className:'邮件测试班',adminEmails:['admin@example.test'],locationConfigured:false}});
  process.env.RESEND_API_KEY='test-only';process.env.MAIL_FROM='test@example.test';process.env.APP_URL='https://example.test';
  const previousFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return new Response(JSON.stringify({error:'test failure'}),{status:500,headers:{'Content-Type':'application/json'}});}) as typeof fetch;
  try{
    const started=Date.now();await processMailJobs(1);const retry=await one('SELECT * FROM email_jobs WHERE id=?',[job.id]);assert.equal(retry.status,'retry');assert.ok(retry.next_attempt>=started+120000);
    const payload=JSON.parse(retry.payload_json);assert.match(payload.subject,/邮件测试班/);assert.match(payload.subject,/活动外出/);
    await run('UPDATE email_jobs SET next_attempt=0 WHERE id=?',[job.id]);await processMailJobs(1);assert.equal((await one('SELECT status FROM email_jobs WHERE id=?',[job.id])).status,'failed');await processMailJobs(1);assert.equal(calls,2);
  }finally{globalThis.fetch=previousFetch;delete process.env.RESEND_API_KEY;delete process.env.MAIL_FROM;delete process.env.APP_URL;}
});
test('学生不能更改业务规则，非法配置与类型删除不会部分保存',async()=>{
  const policy=(await settings()).policy;await assert.rejects(command(student,{action:'policy.save',data:policy}),/权限/);
  await assert.rejects(save({...policy,leaveTypes:policy.leaveTypes.map(t=>({...t,enabled:false}))}));
  await assert.rejects(save({...policy,leaveTypes:[...policy.leaveTypes,policy.leaveTypes[0]]}));
  await assert.rejects(save({...policy,uploads:{...policy.uploads,proofMaxMB:11}}));
  await assert.rejects(save({...policy,leave:{...policy.leave,reasonMaxLength:1}}));
  await assert.rejects(save({...policy,leaveTypes:policy.leaveTypes.slice(1)}),/停用/);
  assert.deepEqual((await settings()).policy,policy);
});
test.after(()=>db().close());

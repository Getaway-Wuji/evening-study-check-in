import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.local',{recursive:true});
process.env.DATABASE_URL=`file:./.local/scheduler-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
process.env.QSTASH_TOKEN='fixture-qstash-token';process.env.CRON_SECRET='fixture-endpoint-secret';process.env.QSTASH_URL='https://qstash-eu-central-1.upstash.io';
process.env.RESEND_API_KEY='fixture-mail-key';process.env.MAIL_FROM='通知 <notify@example.test>';process.env.APP_URL='https://study.example.test';delete process.env.BLOB_READ_WRITE_TOKEN;
const {ready,db,one,run,settings}=await import('../lib/db');
const {publishMailWake,setupMailRecovery,readSchedulerState}=await import('../lib/mail-scheduler');
const {processMailJobs}=await import('../lib/mail');
const {startMailRetryCheck,processMailRetryCheck}=await import('../lib/mail-retry-check');
await ready();for(const [id,role] of [['admin','admin'],['student','student']])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[id,id,'虚构测试用户',role,Date.now()]);
const config=await settings();await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...config,adminEmails:['admin@example.test']})]);
const originalFetch=globalThis.fetch;
const ok=(value:object,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
type Call={url:string;headers:Record<string,string>;body:string};
function mock(handler:(call:Call)=>Response|Promise<Response>){globalThis.fetch=(async(url,init)=>handler({url:String(url),headers:init!.headers as Record<string,string>,body:String(init!.body)})) as typeof fetch;}
async function job(){const leave=crypto.randomUUID(),id=crypto.randomUUID();await run('INSERT INTO leaves(id,user_id,kind,kind_label,reason,proof_ids,created_at) VALUES(?,?,?,?,?,?,?)',[leave,'student','personal','事假','虚构测试原因','[]',Date.now()]);await run('INSERT INTO email_jobs(id,leave_id,next_attempt,created_at) VALUES(?,?,0,?)',[id,leave,Date.now()]);return id;}
test('区域地址正确，调度仅携带空任务或虚构测试编号，授权头从控制台日志隐藏',async()=>{
 const calls:Call[]=[];mock(call=>{calls.push(call);return ok({messageId:'fixture-message'});});
 await publishMailWake(60);assert.equal(calls[0].url,'https://qstash-eu-central-1.upstash.io/v2/publish/https://study.example.test/api/jobs/email');assert.equal(calls[0].body,'{}');assert.equal(calls[0].headers['Upstash-Delay'],'60s');assert.equal(calls[0].headers['Upstash-Forward-Authorization'],'Bearer fixture-endpoint-secret');assert.equal(calls[0].headers['Upstash-Redact-Fields'],'header[Authorization]');
 const id=crypto.randomUUID();await publishMailWake(0,id);assert.deepEqual(JSON.parse(calls[1].body),{retryTestId:id});assert.ok(!calls[1].body.includes('admin@'));
 const saved=process.env.QSTASH_URL;process.env.QSTASH_URL='https://untrusted.example.test';await assert.rejects(publishMailWake(),/QSTASH_URL/);assert.equal(calls.length,2);process.env.QSTASH_URL=saved;
});
test('定时检查使用稳定编号，重复设置更新同一个计划，不携带申请和证明',async()=>{
 const calls:Call[]=[];mock(call=>{calls.push(call);return ok({scheduleId:call.headers['Upstash-Schedule-Id']});});
 await setupMailRecovery();await setupMailRecovery();assert.equal(calls[0].headers['Upstash-Cron'],'*/5 * * * *');assert.equal(calls[0].headers['Upstash-Schedule-Id'],calls[1].headers['Upstash-Schedule-Id']);assert.equal(calls[0].body,'{}');assert.ok((await readSchedulerState('mail-recovery')).scheduleId);
});
test('失败按班级间隔自动排队，未到期不发，达到最多尝试次数停止',async()=>{
 const calls:Call[]=[];mock(call=>{calls.push(call);return call.url.includes('api.resend.com')?ok({error:'fixture'},500):ok({messageId:'fixture-message'});});
 const id=await job();await processMailJobs(1);const first=await one('SELECT * FROM email_jobs WHERE id=?',[id]);assert.equal(first.status,'retry');assert.equal(first.attempts,1);assert.ok(first.next_attempt>Date.now()+55000);
 const before=calls.length;await processMailJobs(1);assert.equal(calls.length,before);
 for(let attempt=2;attempt<=5;attempt++){await run('UPDATE email_jobs SET next_attempt=0 WHERE id=?',[id]);await processMailJobs(1);}
 const last=await one('SELECT * FROM email_jobs WHERE id=?',[id]);assert.equal(last.status,'failed');assert.equal(last.attempts,5);
 assert.deepEqual(calls.filter(c=>!c.url.includes('api.resend.com')).map(c=>c.headers['Upstash-Delay']),['60s','300s','900s','3600s']);
 const sends=calls.filter(c=>c.url.includes('api.resend.com'));assert.equal(sends.length,5);assert.equal(new Set(sends.map(c=>c.headers['Idempotency-Key'])).size,1);assert.equal(new Set(sends.map(c=>c.body)).size,1);
});
test('定时补捞可恢复过期发送租约，多个回调不会并发发送同一邮件',async()=>{
 const id=await job();await run("UPDATE email_jobs SET status='sending',lease_until=? WHERE id=?",[Date.now()-1000,id]);let sends=0;
 mock(async call=>{if(call.url.includes('api.resend.com')){sends++;await new Promise(r=>setTimeout(r,30));return ok({id:'fixture-provider'});}return ok({messageId:'fixture-message'});});
 await Promise.all([processMailJobs(1),processMailJobs(1)]);assert.equal(sends,1);assert.equal((await one('SELECT status FROM email_jobs WHERE id=?',[id])).status,'accepted');await processMailJobs(1);assert.equal(sends,1);
});
test('真实重试测试首次返回 503，下一次才发虚构图片邮件；重复回调不重复发送',async()=>{
 const id=crypto.randomUUID();let sends=0,publishes=0;mock(call=>{if(call.url.includes('api.resend.com')){sends++;const message=JSON.parse(call.body);assert.match(message.subject,/自动重试测试/);assert.match(message.text,/首次回调已模拟临时失败/);assert.equal(message.attachments[0].filename,'邮件测试图片.png');return ok({id:'fixture-retry-mail'});}publishes++;return ok({messageId:'fixture-retry-message'});});
 const before=(await one('SELECT COUNT(*) n FROM leaves')).n;await startMailRetryCheck('admin',id);await startMailRetryCheck('admin',id);assert.equal(publishes,1);
 const first=await processMailRetryCheck(id);assert.equal(first.status,503);assert.equal(first.retryAfter,10);assert.equal(sends,0);
 const second=await processMailRetryCheck(id);assert.equal(second.status,200);await processMailRetryCheck(id);assert.equal(sends,1);assert.equal((await one('SELECT COUNT(*) n FROM leaves')).n,before);
 const row=await one('SELECT * FROM email_retry_checks WHERE id=?',[id]);assert.equal(row.status,'accepted');assert.equal(row.attempts,2);assert.ok(row.first_failure_at);assert.ok(row.completed_at>=row.first_failure_at);
});
test('调度拒绝接收时如实记录失败；测试发送失败次数有上限',async()=>{
 mock(()=>ok({error:'fixture'},429));const refused=crypto.randomUUID();await assert.rejects(startMailRetryCheck('admin',refused),/429/);assert.match((await one('SELECT error FROM email_retry_checks WHERE id=?',[refused])).error,/429/);
 mock(call=>call.url.includes('api.resend.com')?ok({error:'fixture'},500):ok({messageId:'fixture-message'}));const id=crypto.randomUUID();await startMailRetryCheck('admin',id);await processMailRetryCheck(id);await processMailRetryCheck(id);await processMailRetryCheck(id);await processMailRetryCheck(id);assert.equal((await one('SELECT status FROM email_retry_checks WHERE id=?',[id])).status,'failed');assert.equal((await one('SELECT attempts FROM email_retry_checks WHERE id=?',[id])).attempts,3);
});
test.after(()=>{globalThis.fetch=originalFetch;db().close();});

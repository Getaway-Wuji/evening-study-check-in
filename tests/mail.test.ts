import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {mailTestImage} from '../lib/mail-test-image';
import {renderLeaveMail,MAIL_ATTACHMENT_BUDGET,proofMailName} from '../lib/mail-template';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/mail-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
process.env.RESEND_API_KEY='fixture-mail-key';process.env.MAIL_FROM='晚习通知 <notify@example.test>';process.env.APP_URL='https://study.example.test';
delete process.env.QSTASH_TOKEN;delete process.env.CRON_SECRET;delete process.env.BLOB_READ_WRITE_TOKEN;
const {ready,db,one,run,settings}=await import('../lib/db');
const {localPath}=await import('../lib/files');
const {createLeaveMail,materializeMail}=await import('../lib/mail-content');
const {processMailJobs}=await import('../lib/mail');
const {sendMailTest,mailStatus}=await import('../lib/mail-settings');
await ready();
for(const id of ['admin','student','other'])await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[id,id,id==='student'?'测试同学':'测试用户',id==='admin'?'admin':'student',Date.now()]);
const cfg=await settings();await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...cfg,className:'邮件验收班',adminEmails:['admin@example.test']})]);
const {defaultRules}=await import('../lib/domain');
const session=crypto.randomUUID();await run('INSERT INTO sessions(id,date,rules_json,created_at) VALUES(?,?,?,?)',[session,'2099-01-01',JSON.stringify({...defaultRules,locationName:'测试教室'}),Date.now()]);
const originalFetch=globalThis.fetch;
async function file(size=mailTestImage.length,owner='student'){
 const id=crypto.randomUUID();await run('INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,?,?,?,1,?,?)',[id,owner,'证明.png','image/png',size,id,'proof',Date.now()]);
 if(size===mailTestImage.length){await mkdir('data/uploads',{recursive:true});await writeFile(localPath(id),mailTestImage);}
 return id;
}
async function leave(proofs:string[],reason='家庭事务\n请假具体原因 <script>alert(1)</script>'){
 const id=crypto.randomUUID();await run('INSERT INTO leaves(id,user_id,kind,kind_label,reason,proof_ids,created_at) VALUES(?,?,?,?,?,?,?)',[id,'student','personal','事假（原名称）',reason,JSON.stringify(proofs),Date.now()]);
 await run('INSERT INTO leave_items(id,leave_id,user_id,session_id,status) VALUES(?,?,?,?,?)',[crypto.randomUUID(),id,'student',session,'withdrawn']);return id;
}
test('通知完整列出姓名学号、原始类别、具体事由、场次和附件，HTML 转义用户输入',async()=>{
 const id=await leave([await file()]),snapshot=await createLeaveMail(id);
 assert.match(snapshot.subject,/事假（原名称）/);assert.match(snapshot.text,/具体原因：\n家庭事务\n请假具体原因/);assert.match(snapshot.text,/2099-01-01/);assert.match(snapshot.text,/测试教室/);
 assert.match(snapshot.html!,/&lt;script&gt;/);assert.ok(!snapshot.html!.includes('<script>'));
 const message=await materializeMail(snapshot);assert.equal(message.attachments!.length,1);assert.deepEqual(Buffer.from(message.attachments![0].content,'base64'),mailTestImage);
 assert.ok(!('_proofs' in message));assert.ok(!JSON.stringify(snapshot).includes(mailTestImage.toString('base64')));assert.ok(snapshot._proofs!.files[0].sha256);
 assert.match(message.text,/后台查看|后台/);
});
test('大文件超出邮件预算时明确保留登录后台的原件链接，不将原件变为公开链接',async()=>{
 const ids=await Promise.all(Array.from({length:5},()=>file(10*1024*1024))),snapshot=await createLeaveMail(await leave(ids));
 assert.equal(snapshot._proofs!.files.filter(p=>p.attached).length,2);assert.ok(snapshot._proofs!.files.filter(p=>p.attached).reduce((s,p)=>s+p.size,0)<=MAIL_ATTACHMENT_BUDGET);
 assert.match(snapshot.text,/文件较大，请登录后台查看/);for(const id of ids)assert.ok(snapshot.text.includes('/api/files/'+id));assert.ok(!snapshot.text.includes('.blob.vercel-storage.com'));
});
test('证明必须属于申请学生，不能把其他人的文件发送给管理员',async()=>{
 await assert.rejects(createLeaveMail(await leave([await file(mailTestImage.length,'other')])),/身份不符/);
});
test('重试沿用同一封邮件和同一幂等键，附件正文不写入数据库',async()=>{
 const leaveId=await leave([await file()]),job=crypto.randomUUID();await run('INSERT INTO email_jobs(id,leave_id,next_attempt,created_at) VALUES(?,?,0,?)',[job,leaveId,Date.now()]);
 const calls:{key:string;body:string}[]=[];
 globalThis.fetch=(async(_url,init)=>{calls.push({key:(init!.headers as Record<string,string>)['Idempotency-Key'],body:String(init!.body)});return new Response(JSON.stringify(calls.length===1?{error:'fixture'}:{id:'fixture-provider-id'}),{status:calls.length===1?500:200,headers:{'Content-Type':'application/json'}});}) as typeof fetch;
 await processMailJobs(1);assert.equal((await one('SELECT status FROM email_jobs WHERE id=?',[job])).status,'retry');
 await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...await settings(),className:'改名后的班级'})]);await run('UPDATE email_jobs SET next_attempt=0 WHERE id=?',[job]);
 await processMailJobs(1);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal((await one('SELECT status FROM email_jobs WHERE id=?',[job])).status,'accepted');
 assert.ok(!(await one('SELECT payload_json FROM email_jobs WHERE id=?',[job])).payload_json.includes(mailTestImage.toString('base64')));
});
test('缓存附件内容若改变则停止发送，不会用同一幂等键发送不同图片',async()=>{
 const id=await file(),snapshot=await createLeaveMail(await leave([id]));await materializeMail(snapshot);
 const changed=Buffer.from(mailTestImage);changed[changed.length-10]^=1;await writeFile(localPath(id),changed);
 await assert.rejects(materializeMail(snapshot),/内容已改变/);
});
test('邮件测试使用虚构资料和 PNG，不创建真实请假；同一测试请求不会重复投递',async()=>{
 let calls=0;globalThis.fetch=(async(_url,init)=>{calls++;const payload=JSON.parse(String(init!.body));assert.match(payload.subject,/【测试】/);assert.match(payload.text,/均为虚构/);assert.equal(payload.attachments[0].filename,'邮件测试图片.png');assert.ok(!payload.text.includes('/api/files/test-image'));return new Response(JSON.stringify({id:'fixture-test-id'}),{headers:{'Content-Type':'application/json'}});}) as typeof fetch;
 const before=(await one('SELECT COUNT(*) n FROM leaves')).n,id=crypto.randomUUID();assert.equal((await sendMailTest('admin',id)).providerId,'fixture-test-id');await sendMailTest('admin',id);assert.equal(calls,1);assert.equal((await one('SELECT COUNT(*) n FROM leaves')).n,before);
 const status=await mailStatus();assert.equal(status.lastTest?.provider_id,'fixture-test-id');assert.ok(!JSON.stringify(status).includes('fixture-mail-key'));assert.ok(!('payload_json' in status.lastTest!));
});
test('证明文件名去除路径和控制字符，并按真实类型使用后缀',()=>{
 const name=proofMailName('../../截图\u0000.exe','image/png',0);assert.ok(name.endsWith('.png'));assert.ok(!/[\/\\\u0000]/.test(name));
});
test.after(()=>{globalThis.fetch=originalFetch;db().close();});

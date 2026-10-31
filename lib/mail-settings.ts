import {ready,settings,one,run,audit} from './db';
import {mailOrigin} from './mail-content';
import {sendResend} from './mail';
import {renderLeaveMail} from './mail-template';
import {mailTestImage} from './mail-test-image';
import {testPrivateProof} from './files';
export async function mailStatus(){
  const config=await settings();
  const last=await one('SELECT id,provider_id,error,created_at FROM email_tests ORDER BY created_at DESC LIMIT 1');
  return {enabled:config.policy.notifications.enabled,serviceConfigured:!!process.env.RESEND_API_KEY,sender:process.env.MAIL_FROM||'',recipients:config.adminEmails||[],schedulerConfigured:!!(process.env.QSTASH_TOKEN&&process.env.CRON_SECRET),lastTest:last||null};
}
export async function sendMailTest(userId:string,id:string){
  await ready();const config=await settings();
  if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)throw new Error('请先配置发信服务和发件地址');
  if(!config.adminEmails?.length)throw new Error('请先填写并保存管理员收件邮箱');
  const now=Date.now(),content=renderLeaveMail({className:config.className,id,studentName:'测试学生（虚构）',studentCode:'TEST-EMAIL',kind:'事假（测试）',reason:'这是邮件连通性测试：模拟因家庭事务请假。所有申请信息均为虚构，请检查正文和 PNG 附件，无需审批。',createdAt:now,dates:[{date:new Date(now+8*3600000).toISOString().slice(0,10),open:'18:00',close:'19:00',location:'测试教室（虚构）'}],proofs:[{id:'test-image',name:'邮件测试图片.png',contentType:'image/png',size:mailTestImage.length,attached:true}],base:mailOrigin(),test:true});
  const message={from:process.env.MAIL_FROM,to:config.adminEmails,...content,attachments:[{filename:'邮件测试图片.png',content:mailTestImage.toString('base64')}]};
  await run('INSERT OR IGNORE INTO email_tests(id,payload_json,created_at) VALUES(?,?,?)',[id,JSON.stringify(message),now]);
  const record=await one('SELECT * FROM email_tests WHERE id=?',[id]);
  if(record.provider_id)return {id,providerId:record.provider_id,message:'此测试邮件已被服务商接收，请检查管理员收件箱和垃圾邮件。'};
  try{
    const storage=await testPrivateProof(id,mailTestImage);
    const providerId=await sendResend(JSON.parse(record.payload_json),`study-mail-test/${id}`);
    await run('UPDATE email_tests SET provider_id=?,error=NULL WHERE id=?',[providerId,id]);
    await audit(userId,'发送邮件连通测试',{id,providerId,privateStorageChecked:storage.privateStorageChecked});
    return {id,providerId,message:'测试邮件已被服务商接收，请检查管理员收件箱和垃圾邮件；这尚不等于已进入收件箱。'};
  }catch(error){const message=error instanceof Error?error.message:'测试发送失败';await run('UPDATE email_tests SET error=? WHERE id=?',[message,id]);throw new Error(message);}
}

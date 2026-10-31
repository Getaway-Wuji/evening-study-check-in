import {one,run,transaction,audit,settings} from './db';
import {publishMailWake,schedulerConfigured} from './mail-scheduler';
import {sendMailTest} from './mail-settings';
export async function startMailRetryCheck(userId:string,id:string){
  if(!schedulerConfigured())throw new Error('请先配置自动重试服务');
  if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)throw new Error('请先配置邮件发信服务');
  if(!(await settings()).adminEmails?.length)throw new Error('请先保存管理员收件邮箱');
  await run('INSERT OR IGNORE INTO email_retry_checks(id,user_id,created_at) VALUES(?,?,?)',[id,userId,Date.now()]);
  const check=await one('SELECT * FROM email_retry_checks WHERE id=?',[id]);
  if(check.message_id||check.status==='accepted')return {id,message:'测试已安排，请刷新查看回调和重试结果。'};
  try{
    const messageId=await publishMailWake(0,id);await run('UPDATE email_retry_checks SET message_id=?,error=NULL WHERE id=?',[messageId,id]);
    await audit(userId,'开始邮件自动重试测试',{id,messageId});
    return {id,message:'测试已交给调度服务：首次回调会模拟失败，约 10 秒后自动重试并发送含图片的测试邮件。'};
  }catch(error){await run('UPDATE email_retry_checks SET error=? WHERE id=?',[error instanceof Error?error.message:'调度失败',id]);throw error;}
}
export async function processMailRetryCheck(id:string){
  const claim=await transaction(async tx=>{
    const record=await one('SELECT * FROM email_retry_checks WHERE id=?',[id],tx);if(!record)return {skip:true};
    if(['accepted','failed'].includes(record.status))return {skip:true};
    if(record.lease_until>Date.now())return {busy:true};
    const attempts=Number(record.attempts)+1;
    if(attempts===1){await run("UPDATE email_retry_checks SET status='retry',attempts=1,first_failure_at=?,error=? WHERE id=?",[Date.now(),'首次模拟临时故障（测试），等待自动重试',id],tx);return {first:true};}
    if(attempts>3){await run("UPDATE email_retry_checks SET status='failed',lease_until=NULL WHERE id=?",[id],tx);return {skip:true};}
    await run("UPDATE email_retry_checks SET status='sending',attempts=?,lease_until=? WHERE id=?",[attempts,Date.now()+60000,id],tx);return {record,attempts};
  });
  if('skip' in claim)return {status:200,body:{ok:true}};
  if('first' in claim||'busy' in claim)return {status:503,body:{retry:true},retryAfter:10};
  try{
    const result=await sendMailTest(claim.record.user_id,id,true);
    await run("UPDATE email_retry_checks SET status='accepted',provider_id=?,completed_at=?,lease_until=NULL,error=NULL WHERE id=?",[result.providerId,Date.now(),id]);
    return {status:200,body:{ok:true}};
  }catch(error){
    const status=claim.attempts>=3?'failed':'retry';await run('UPDATE email_retry_checks SET status=?,error=?,lease_until=NULL WHERE id=?',[status,error instanceof Error?error.message:'发送失败',id]);
    return {status:status==='failed'?200:503,body:{ok:false,terminal:status==='failed',retry:status==='retry'},retryAfter:10};
  }
}

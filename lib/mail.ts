import { one, rows, run, settings, type DBRow } from './db';
import {createLeaveMail,materializeMail,type MailSnapshot,type ResendMessage} from './mail-content';
export function mailFailure(status:number){return status===401?'发信密钥无效，请重新配置邮件服务':status===403?'发件域名未验证或密钥权限不足，请核对邮件服务':status===429?'邮件服务达到当前频率或免费额度限制，请稍后重试':status===413?'邮件体积超过服务商限制，请联系管理员':`邮件服务暂时未接收（${status}）`;}
export async function sendResend(message:ResendMessage,key:string){
  const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
  const body=await res.json();if(!res.ok||typeof body.id!=='string')throw new Error(mailFailure(res.status));return body.id as string;
}
export async function wakeEmail(delay=0) {
  if(!process.env.QSTASH_TOKEN||!process.env.CRON_SECRET||!process.env.APP_URL?.startsWith('https://'))return;
  if(!(await settings()).policy.notifications.enabled)return;
  try{
    const url=process.env.APP_URL+'/api/jobs/email';
    const response=await fetch('https://qstash.upstash.io/v2/publish/'+url,{method:'POST',headers:{Authorization:`Bearer ${process.env.QSTASH_TOKEN}`,'Content-Type':'application/json','Upstash-Forward-Authorization':`Bearer ${process.env.CRON_SECRET}`,'Upstash-Retries':'5',...(delay?{'Upstash-Delay':`${delay}s`}:{})},body:'{}',signal:AbortSignal.timeout(5000)});
    if(!response.ok)console.error('Notification scheduler unavailable',response.status);
  }catch{console.error('Notification scheduler unavailable');}
}
export async function processMailJobs(limit=3) {
  const initial=await settings();if(!initial.policy.notifications.enabled)return [];
  const jobs=await rows("SELECT id FROM email_jobs WHERE status IN ('pending','retry','sending') AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?) AND attempts<? ORDER BY created_at LIMIT ?",[Date.now(),Date.now(),initial.policy.notifications.maxAttempts,limit]);
  const results=[];
  for(const candidate of jobs){
    const claim=await one("UPDATE email_jobs SET status='sending',lease_until=? WHERE id=? AND status IN ('pending','retry','sending') AND (lease_until IS NULL OR lease_until<?) RETURNING *",[Date.now()+60000,candidate.id,Date.now()]);
    if(!claim)continue;
    const config=await settings();
    if(!config.policy.notifications.enabled){await run("UPDATE email_jobs SET status='blocked',lease_until=NULL,error=? WHERE id=?",['班级管理员已关闭邮件通知',claim.id]);continue;}
    if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM||!config.adminEmails?.length){
      await run("UPDATE email_jobs SET status='blocked',lease_until=NULL,error=? WHERE id=?",['请先配置发件服务和管理员收件邮箱',claim.id]);
      results.push({id:claim.id,status:'blocked'});continue;
    }
    try{
      let payload:MailSnapshot|null=claim.payload_json?JSON.parse(claim.payload_json):null;
      if(!payload){
        payload=await createLeaveMail(claim.leave_id);
        await run('UPDATE email_jobs SET payload_json=? WHERE id=?',[JSON.stringify(payload),claim.id]);
      }
      const message=await materializeMail(payload);
      // Persist small immutable references and hashes, never attachment Base64 in the database.
      await run('UPDATE email_jobs SET payload_json=? WHERE id=?',[JSON.stringify(payload),claim.id]);
      const providerId=await sendResend(message,`study-leave/${claim.id}`);
      await run("UPDATE email_jobs SET status='accepted',provider_id=?,attempts=attempts+1,lease_until=NULL,error=NULL WHERE id=?",[providerId,claim.id]);
      results.push({id:claim.id,status:'accepted'});
    }catch(e){
      const attempts=Number(claim.attempts)+1,delays=config.policy.notifications.retryMinutes,delay=delays[Math.min(attempts-1,delays.length-1)]*60,status=attempts>=config.policy.notifications.maxAttempts?'failed':'retry';
      await run('UPDATE email_jobs SET status=?,attempts=?,next_attempt=?,lease_until=NULL,error=? WHERE id=?',[status,attempts,Date.now()+delay*1000,e instanceof Error?e.message:'发送失败',claim.id]);
      if(status==='retry')await wakeEmail(delay);
      results.push({id:claim.id,status});
    }
  }
  if(await one("SELECT id FROM email_jobs WHERE status IN ('pending','retry') AND next_attempt<=? LIMIT 1",[Date.now()]))await wakeEmail(2);
  return results;
}

import { one, rows, run, settings, type DBRow } from './db';
import { leaveKinds, aggregateLeave, type LeaveKind } from './domain';
export async function wakeEmail(delay=0) {
  if(!process.env.QSTASH_TOKEN||!process.env.CRON_SECRET||!process.env.APP_URL?.startsWith('https://'))return;
  try{
    const url=process.env.APP_URL+'/api/jobs/email';
    const response=await fetch('https://qstash.upstash.io/v2/publish/'+url,{method:'POST',headers:{Authorization:`Bearer ${process.env.QSTASH_TOKEN}`,'Content-Type':'application/json','Upstash-Forward-Authorization':`Bearer ${process.env.CRON_SECRET}`,'Upstash-Retries':'5',...(delay?{'Upstash-Delay':`${delay}s`}:{})},body:'{}',signal:AbortSignal.timeout(5000)});
    if(!response.ok)console.error('Notification scheduler unavailable',response.status);
  }catch{console.error('Notification scheduler unavailable');}
}
export async function processMailJobs(limit=3) {
  const jobs=await rows("SELECT id FROM email_jobs WHERE status IN ('pending','retry','sending') AND next_attempt<=? AND (lease_until IS NULL OR lease_until<?) AND attempts<5 ORDER BY created_at LIMIT ?",[Date.now(),Date.now(),limit]);
  const results=[];
  for(const candidate of jobs){
    const claim=await one("UPDATE email_jobs SET status='sending',lease_until=? WHERE id=? AND status IN ('pending','retry','sending') AND (lease_until IS NULL OR lease_until<?) RETURNING *",[Date.now()+60000,candidate.id,Date.now()]);
    if(!claim)continue;
    const config=await settings();
    if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM||!config.adminEmails?.length){
      await run("UPDATE email_jobs SET status='blocked',lease_until=NULL,error=? WHERE id=?",['请先配置发件服务和管理员收件邮箱',claim.id]);
      results.push({id:claim.id,status:'blocked'});continue;
    }
    try{
      let payload=claim.payload_json?JSON.parse(claim.payload_json):null;
      if(!payload){
        const leave=await one('SELECT l.*,u.name,u.code FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.id=?',[claim.leave_id]);
        const items=await rows('SELECT s.date,i.status FROM leave_items i JOIN sessions s ON s.id=i.session_id WHERE i.leave_id=? ORDER BY s.date',[claim.leave_id]);
        const base=process.env.APP_URL;
        if(!base?.startsWith('https://')&&!base?.startsWith('http://127.0.0.1'))throw new Error('请配置有效的 APP_URL');
        payload={from:process.env.MAIL_FROM,to:config.adminEmails,subject:`晚自习请假申请 · ${leave.name} · ${leaveKinds[leave.kind as LeaveKind]}`,text:[
          `申请编号：${leave.id}`,`学生：${leave.name}（${leave.code}）`,`类型：${leaveKinds[leave.kind as LeaveKind]}`,
          `场次：${items.map(x=>x.date).join('、')}`,`提交时间：${new Date(leave.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`,
          `请登录后台查看申请说明和证明材料：${base}/admin/leaves`, '本邮件仅作提交提醒，审批以后台当前状态为准。',
        ].join('\n')};
        await run('UPDATE email_jobs SET payload_json=? WHERE id=?',[JSON.stringify(payload),claim.id]);
      }
      const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`study-leave/${claim.id}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
      const body=await res.json();
      if(!res.ok||!body.id)throw new Error(`邮件服务暂时未接收（${res.status}）`);
      await run("UPDATE email_jobs SET status='accepted',provider_id=?,attempts=attempts+1,lease_until=NULL,error=NULL WHERE id=?",[body.id,claim.id]);
      results.push({id:claim.id,status:'accepted'});
    }catch(e){
      const attempts=Number(claim.attempts)+1, delays=[60,300,900,3600,10800],delay=delays[Math.min(attempts-1,4)];
      await run('UPDATE email_jobs SET status=?,attempts=?,next_attempt=?,lease_until=NULL,error=? WHERE id=?',[attempts>=5?'failed':'retry',attempts,Date.now()+delay*1000,e instanceof Error?e.message:'发送失败',claim.id]);
      if(attempts<5)await wakeEmail(delay);
      results.push({id:claim.id,status:'retry'});
    }
  }
  return results;
}

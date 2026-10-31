import {createHash} from 'node:crypto';
import {one,rows,settings} from './db';
import {leaveLabel} from './class-policy';
import {readPrivateProof} from './files';
import {MAIL_ATTACHMENT_BUDGET,proofMailName,renderLeaveMail,type MailProof} from './mail-template';
export interface ResendMessage {from:string;to:string[];subject:string;text:string;html?:string;attachments?:{filename:string;content:string}[]}
export type MailSnapshot=ResendMessage&{_proofs?:{ownerId:string;files:MailProof[]}};
export function mailOrigin(){
  const url=new URL(process.env.APP_URL||'');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!process.env.VERCEL))throw new Error('请配置有效的 APP_URL');
  return url.origin;
}
export async function createLeaveMail(leaveId:string):Promise<MailSnapshot>{
  const config=await settings(),leave=await one('SELECT l.*,u.name,u.code FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.id=?',[leaveId]);
  if(!leave)throw new Error('请假申请不存在，无法生成通知');
  const items=await rows('SELECT s.date,s.rules_json FROM leave_items i JOIN sessions s ON s.id=i.session_id WHERE i.leave_id=? ORDER BY s.date',[leaveId]);
  const ids=JSON.parse(leave.proof_ids) as string[];let budget=MAIL_ATTACHMENT_BUDGET;
  const proofs:MailProof[]=[];
  for(const [index,id] of ids.entries()){
    const file=await one("SELECT * FROM files WHERE id=? AND user_id=? AND purpose='proof' AND ready=1",[id,leave.user_id]);
    if(!file)throw new Error('申请证明材料未就绪或身份不符');
    const size=Number(file.size);if(!Number.isSafeInteger(size)||size<=0||size>10*1024*1024)throw new Error('证明材料大小不符合已接收文件要求');
    const attached=size<=budget;
    if(attached)budget-=size;
    proofs.push({id,name:proofMailName(file.name,file.content_type,index),contentType:file.content_type,size,attached});
  }
  const content=renderLeaveMail({className:config.className,id:leave.id,studentName:leave.name,studentCode:leave.code,kind:leaveLabel(leave as {kind:string},config.policy),reason:leave.reason,createdAt:leave.created_at,
    dates:items.map(item=>{const r=JSON.parse(item.rules_json);return {date:item.date,open:r.open,close:r.close,location:r.locationName};}),proofs,base:mailOrigin()});
  return {from:process.env.MAIL_FROM!,to:config.adminEmails!,...content,_proofs:{ownerId:leave.user_id,files:proofs}};
}
export async function materializeMail(snapshot:MailSnapshot):Promise<ResendMessage>{
  const {_proofs,...message}=snapshot;
  if(!_proofs)return message; // Keep already-snapshotted legacy notifications identical on retry.
  const selected=_proofs.files.filter(file=>file.attached);
  if(selected.reduce((sum,file)=>sum+file.size,0)>MAIL_ATTACHMENT_BUDGET)throw new Error('邮件附件超出发送预算');
  const attachments=await Promise.all(selected.map(async proof=>{
    const file=await one("SELECT * FROM files WHERE id=? AND user_id=? AND purpose='proof' AND ready=1",[proof.id,_proofs.ownerId]);
    if(!file||Number(file.size)!==proof.size||file.content_type!==proof.contentType)throw new Error('邮件证明原件已改变或不可访问');
    const bytes=await readPrivateProof(file),digest=createHash('sha256').update(bytes).digest('hex');
    if(proof.sha256&&proof.sha256!==digest)throw new Error('证明材料内容已改变，已停止重复发送');
    proof.sha256=digest;
    return {filename:proof.name,content:bytes.toString('base64')};
  }));
  return {...message,...(attachments.length?{attachments}:{})};
}

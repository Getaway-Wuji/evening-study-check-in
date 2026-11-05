import {z} from 'zod';
import {HTTPError} from './auth';
import {one,run,audit,auditStatement,settings,businessNow,type DBRow,type Connection} from './db';
import type {InStatement} from '@libsql/client';
import type {AttendanceChange} from './attendance-change';
import {attachments} from './attachments';
import {makeupWindow,MIN_MAKEUP_REASON_LENGTH} from './class-policy';
import type {Rules} from './domain';
import {requireAttendance} from './exemptions';

export async function invalidateMakeups(sessionId:string,userId:string,reason:string,c:Connection){
  await run("UPDATE makeup_requests SET status='invalid',review_note=?,reviewed_at=? WHERE session_id=? AND user_id=? AND status='pending'",[reason,Date.now(),sessionId,userId],c);
}
export async function makeupCommand(user:DBRow,action:string,data:unknown,tx:Connection):Promise<Record<string,unknown>>{
  if(action==='makeup.create'){
    const policy=(await settings(tx)).policy;
    if(!policy.makeup.enabled)throw new Error('本班暂未开放人工补签申请，请联系管理员');
    const input=z.object({sessionId:z.string(),reason:z.string().trim().max(2000),photoIds:z.array(z.string()).min(1,'请上传至少一张现场照片').max(policy.uploads.photoMaxFiles),failureNote:z.string().trim().max(500).default('')}).parse(data);
    if(input.reason.length<MIN_MAKEUP_REASON_LENGTH)throw new Error(`请至少填写 ${MIN_MAKEUP_REASON_LENGTH} 字补签说明`);
    const s=await one('SELECT s.* FROM sessions s JOIN session_members m ON m.session_id=s.id WHERE s.id=? AND m.user_id=?',[input.sessionId,user.id],tx);
    if(!s||s.cancelled)throw new Error('本次晚自习不存在、已取消或不适用于你');
    await requireAttendance(user.id,s.date,tx);
    const rules:Rules=JSON.parse(s.rules_json),window=makeupWindow(s.date,rules,policy),now=businessNow();
    if(!rules.locationRequired)throw new Error('本场不要求定位，请使用正常打卡或联系管理员');
    if(now<window.opensAt)throw new Error('本场尚未开始打卡，不能提前申请补签');
    if(now>=window.closesAt)throw new Error('已超过本班设置的补签申请期限，请联系管理员');
    if(await one('SELECT id FROM checkins WHERE session_id=? AND user_id=?',[s.id,user.id],tx))throw new Error('本场已成功打卡，无需申请补签');
    if(await one("SELECT id FROM leave_items WHERE session_id=? AND user_id=? AND status='approved'",[s.id,user.id],tx))throw new Error('本场已批准请假，请先联系管理员撤销请假');
    const existing=await one("SELECT id FROM makeup_requests WHERE session_id=? AND user_id=? AND status='pending'",[s.id,user.id],tx);
    if(existing)return {message:'本场已有补签申请，请等待管理员审核',id:existing.id};
    await attachments(input.photoIds,'photo',user.id,tx);
    const id=crypto.randomUUID();
    await run('INSERT INTO makeup_requests(id,user_id,session_id,reason,photo_ids,failure_note,created_at,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,?,?)',[id,user.id,s.id,input.reason,JSON.stringify(input.photoIds),input.failureNote,now,s.rules_json,s.version],tx);
    await audit(user.id,'提交人工补签申请',{id,session:s.date},tx);
    return {message:'补签申请已提交，审核通过后才计入出勤',id};
  }
  const input=z.object({id:z.string(),decision:z.enum(['approved','rejected']).optional(),note:z.string().trim().max(500).default('')}).parse(data);
  const request=await one(action==='makeup.review'?`SELECT m.*,
    EXISTS(SELECT 1 FROM sessions s JOIN session_members sm ON sm.session_id=s.id JOIN users u ON u.id=sm.user_id WHERE s.id=m.session_id AND sm.user_id=m.user_id AND s.cancelled=0 AND u.active=1 AND u.role='student') AS session_valid,
    EXISTS(SELECT 1 FROM attendance_exemptions e JOIN sessions s ON s.id=m.session_id WHERE e.user_id=m.user_id AND e.cancelled_at IS NULL AND e.starts_on<=s.date AND (e.ends_on IS NULL OR e.ends_on>=s.date)) AS exempt,
    EXISTS(SELECT 1 FROM checkins c WHERE c.session_id=m.session_id AND c.user_id=m.user_id) AS checked,
    EXISTS(SELECT 1 FROM leave_items l WHERE l.session_id=m.session_id AND l.user_id=m.user_id AND l.status='approved') AS on_leave
    FROM makeup_requests m WHERE m.id=?`:'SELECT * FROM makeup_requests WHERE id=?',[input.id],tx);
  if(!request)throw new Error('补签申请不存在');
  if(action==='makeup.withdraw'){
    if(request.user_id!==user.id)throw new HTTPError(403,'无法操作他人的补签申请');
    if(request.status!=='pending')throw new Error('当前申请不能撤回，请刷新后查看');
    await run("UPDATE makeup_requests SET status='withdrawn' WHERE id=? AND status='pending'",[request.id],tx);
    await audit(user.id,'撤回人工补签申请',{id:request.id},tx);
    return {message:'补签申请已撤回'};
  }
  if(action!=='makeup.review')throw new Error('不支持的补签操作');
  if(request.status!=='pending')throw new Error('申请已处理或失效，请刷新后查看');
  if(!input.decision)throw new Error('请选择审核结果');
  if(input.decision==='rejected'&&input.note.length<2)throw new Error('请填写驳回原因（至少 2 字）');
  let checkinId:string|null=null;
  const statements:InStatement[]=[],reviewedAt=Date.now(),change:AttendanceChange={sessionId:request.session_id,userId:request.user_id,now:businessNow()};
  if(input.decision==='approved'){
    if(!request.session_valid)throw new Error('场次已取消或学生不再适用，请驳回申请');
    if(request.exempt)throw new Error('本场已设置免打卡，无需打卡、请假或补签');
    if(request.checked)throw new Error('学生已成功打卡，请刷新后核对');
    if(request.on_leave)throw new Error('本场已批准请假，请先撤销请假再处理补签');
    checkinId=crypto.randomUUID();
    const note=`人工补签：${request.reason}${input.note?'\n核实意见：'+input.note:''}`;
    statements.push({sql:'INSERT INTO checkins(id,session_id,user_id,submitted_at,source_coords,photo_ids,note,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,?,?)',args:[checkinId,request.session_id,request.user_id,change.now,'makeup:'+request.id,request.photo_ids,note,request.rule_snapshot,request.rule_version]},
      {sql:"UPDATE leave_items SET status='invalid',review_note='人工补签已通过，本场请假申请失效',reviewer_id=?,reviewed_at=? WHERE session_id=? AND user_id=? AND status='pending'",args:[user.id,reviewedAt,request.session_id,request.user_id]});
    change.checkin={id:checkinId,session_id:request.session_id,user_id:request.user_id,submitted_at:change.now,latitude:null,longitude:null,accuracy:null,distance:null,captured_at:null,photo_ids:request.photo_ids,photoIds:JSON.parse(request.photo_ids),note,rule_version:request.rule_version,method:'makeup'};
    change.invalidate={leaveNote:'人工补签已通过，本场请假申请失效',reviewedAt,reviewerId:user.id};
  }
  statements.push({sql:'UPDATE makeup_requests SET status=?,review_note=?,reviewer_id=?,reviewed_at=?,checkin_id=? WHERE id=? AND status=\'pending\'',args:[input.decision,input.note,user.id,reviewedAt,checkinId,request.id]},auditStatement(user.id,'审核人工补签申请',{id:request.id,decision:input.decision,note:input.note,checkinId}));
  await tx.batch(statements);
  change.review={id:request.id,status:input.decision,review_note:input.note,reviewer_id:user.id,reviewed_at:reviewedAt,checkin_id:checkinId};
  return {message:input.decision==='approved'?'补签已通过，已计为打卡成功':'申请已驳回，原因已同步给学生',id:request.id,attendanceChange:change};
}

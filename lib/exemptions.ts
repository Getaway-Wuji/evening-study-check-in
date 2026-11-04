import {z} from 'zod';
import {dateCN,addDays,validDate} from './domain';
import {one,run,audit,businessNow,type Connection,type DBRow} from './db';

export async function requireAttendance(userId:string,date:string,c:Connection){
  if(await one('SELECT id FROM attendance_exemptions WHERE user_id=? AND cancelled_at IS NULL AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)',[userId,date,date],c)){
    throw new Error('本场已设置免打卡，无需打卡、请假或补签');
  }
}

export async function exemptionCommand(user:DBRow,action:string,data:unknown,tx:Connection){
  const today=dateCN(businessNow());
  if(action==='exemption.create'){
    const day=z.string().refine(validDate,'日期无效');
    const input=z.object({studentId:z.string(),startsOn:day,endsOn:day.nullable(),reason:z.string().trim().max(500).default('')}).parse(data);
    if(input.startsOn<today)throw new Error('免打卡开始日期不能早于今天，历史考勤保持原样');
    if(input.endsOn&&input.endsOn<input.startsOn)throw new Error('结束日期不能早于开始日期');
    if(!await one("SELECT id FROM users WHERE id=? AND role='student' AND active=1",[input.studentId],tx))throw new Error('学生不存在或已停用');
    if(await one('SELECT id FROM attendance_exemptions WHERE user_id=? AND cancelled_at IS NULL AND starts_on<=? AND (ends_on IS NULL OR ends_on>=?)',[input.studentId,input.endsOn||'9999-12-31',input.startsOn],tx))throw new Error('该时段已有免打卡设置，请先结束或取消原设置');
    const id=crypto.randomUUID();
    await run('INSERT INTO attendance_exemptions(id,user_id,starts_on,ends_on,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)',[id,input.studentId,input.startsOn,input.endsOn,input.reason,user.id,Date.now()],tx);
    // Pending requests in the exempt period no longer need approval. Keep their evidence and history.
    for(const table of ['leave_items','makeup_requests'])await run(`UPDATE ${table} SET status='invalid',review_note='管理员已设置本场免打卡，无需继续审批',reviewer_id=?,reviewed_at=? WHERE user_id=? AND status='pending' AND session_id IN (SELECT id FROM sessions WHERE date>=? AND date<=?)`,[user.id,Date.now(),input.studentId,input.startsOn,input.endsOn||'9999-12-31'],tx);
    await audit(user.id,'设置学生免打卡',{id,...input},tx);
    return {message:'免打卡已设置，生效期间无需提交，不计为缺勤',id};
  }
  if(action==='exemption.end'){
    const {id}=z.object({id:z.string()}).parse(data);
    const record=await one('SELECT * FROM attendance_exemptions WHERE id=?',[id],tx);
    if(!record||record.cancelled_at!==null||(record.ends_on&&record.ends_on<today))throw new Error('这条免打卡设置已结束或取消，请刷新查看');
    if(record.starts_on>=today)await run('UPDATE attendance_exemptions SET cancelled_at=? WHERE id=?',[Date.now(),id],tx);
    else await run('UPDATE attendance_exemptions SET ends_on=? WHERE id=?',[addDays(today,-1),id],tx);
    await audit(user.id,'结束学生免打卡',{id,studentId:record.user_id,restoreFrom:today,previous:record},tx);
    return {message:record.starts_on>today?'已取消这条尚未开始的免打卡设置':'已从今天恢复打卡要求，之前的免打卡记录保留'};
  }
  throw new Error('不支持的免打卡操作');
}

import { z } from 'zod';
import { HTTPError } from './auth';
import { ready, rows, one, run, transaction, audit, settings, rulesFor, businessNow, demoMode, db, type DBRow, type Connection } from './db';
import { dateCN, validDate, addDays, period, timeMinutes, checkLocation, type Rules } from './domain';
import { normalizeStudentCode } from './identity';
import { rulesSchema } from './validation';
import { readTimetable,timetableCommand,resolveRecurringDate } from './timetable';
export { rulesSchema } from './validation';

const day=z.string().refine(validDate,'日期无效');

export async function attachments(ids: string[], purpose: string, userId: string,c: Connection) {
  if (new Set(ids).size!==ids.length) throw new Error('附件不能重复选择');
  for (const id of ids) if (!await one('SELECT id FROM files WHERE id=? AND user_id=? AND purpose=? AND ready=1',[id,userId,purpose],c)) throw new Error('附件尚未上传完成或无权使用');
}
async function member(sessionId: string, userId: string,c: Connection) {
  const s=await one('SELECT s.* FROM sessions s JOIN session_members m ON m.session_id=s.id WHERE s.id=? AND m.user_id=?',[sessionId,userId],c);
  if (!s || s.cancelled) throw new Error('本次晚自习不存在、已取消或不适用于你');
  return s;
}
export async function createSession(date: string,c: Connection, override?: Rules, reason='') {
  const id=crypto.randomUUID(), rules=override || await rulesFor(date,c);
  await run('INSERT INTO sessions(id,date,rules_json,is_override,reason,created_at) VALUES(?,?,?,?,?,?)',[id,date,JSON.stringify(rules),override?1:0,reason,Date.now()],c);
  await run("INSERT INTO session_members(session_id,user_id) SELECT ?,id FROM users WHERE role='student' AND active=1",[id],c);
  return id;
}
export async function bootstrap(user: DBRow) {
  await ready();
  const admin=user.role==='admin', filter=admin?'':' WHERE user_id=?', args=admin?[]:[user.id];
  const [config, sessions, checkins, leaves, items, students, files, jobs, logs, versions,timetable]=await Promise.all([
    settings(), rows('SELECT * FROM sessions ORDER BY date'),
    rows('SELECT * FROM checkins'+filter,args), rows('SELECT * FROM leaves'+filter,args), rows<DBRow & {status:string}>('SELECT * FROM leave_items'+filter,args),
    admin?rows("SELECT id,code,name,role,active,CASE WHEN password_hash IS NOT NULL OR openid IS NOT NULL THEN 1 ELSE 0 END AS registered,CASE WHEN openid IS NOT NULL THEN 1 ELSE 0 END AS wechat FROM users WHERE role='student' ORDER BY code"):rows('SELECT id,code,name,role,active FROM users WHERE id=?',[user.id]),
    rows('SELECT id,user_id,name,content_type,size,purpose FROM files WHERE ready=1'+(admin?'':' AND user_id=?'),args),
    admin?rows('SELECT id,leave_id,status,attempts,next_attempt,provider_id,error,created_at FROM email_jobs ORDER BY created_at DESC LIMIT 100'):Promise.resolve([]),
    admin?rows('SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT 60'):Promise.resolve([]),
    rows('SELECT * FROM defaults_versions ORDER BY effective_from DESC,created_at DESC'),
    readTimetable(db()),
  ]);
  const members=admin?await rows('SELECT * FROM session_members'):await rows('SELECT * FROM session_members WHERE user_id=?',[user.id]);
  return { user,...timetable,recurring:admin?timetable.recurring:[],terms:admin?timetable.terms:timetable.terms.filter(t=>t.id===config.currentTermId),settings:admin?config:{className:config.className,capacity:config.capacity,locationConfigured:config.locationConfigured,currentTermId:config.currentTermId},
    sessions:sessions.filter(s=>admin||members.some(m=>m.session_id===s.id)).map(s=>({...s,rules:JSON.parse(s.rules_json),rules_json:undefined}) as DBRow & {rules:Rules}),
    checkins:checkins.map(c=>({...c,photoIds:JSON.parse(c.photo_ids),rule_snapshot:undefined,source_coords:undefined}) as DBRow & {photoIds:string[]}),
    leaves:leaves.map(l=>({...l,proofIds:JSON.parse(l.proof_ids),items:items.filter(i=>i.leave_id===l.id)}) as DBRow & {proofIds:string[];items:(DBRow & {status:string})[]}),
    students,files,jobs,logs,members,defaults:versions.map(v=>({...v,rules:JSON.parse(v.rules_json),rules_json:undefined}) as DBRow & {rules:Rules}),
    now:businessNow(),demo:demoMode(),integrations:admin?{
      wechat:!!(process.env.WECHAT_APP_ID&&process.env.WECHAT_APP_SECRET),
      email:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM&&config.adminEmails?.length),
      storage:!!process.env.BLOB_READ_WRITE_TOKEN,remoteDatabase:/^(libsql|https):/.test(process.env.DATABASE_URL||''),
      scheduler:!!(process.env.QSTASH_TOKEN&&process.env.CRON_SECRET),
    }:undefined };
}
export async function command(user: DBRow, raw: unknown): Promise<Record<string,any>> {
  const {action,data}=z.object({action:z.string(),data:z.any()}).parse(raw);
  const studentActions=['checkin','leave.create','leave.withdraw'];
  if (studentActions.includes(action) ? user.role!=='student' : user.role!=='admin') throw new HTTPError(403,'没有执行此操作的权限');
  return transaction(async tx=>{
    if(action.startsWith('term.')||action.startsWith('recurrence.'))return timetableCommand(user,action,data,tx);
    if (action==='checkin') {
      const input=z.object({sessionId:z.string(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),accuracy:z.number().optional(),capturedAt:z.number().optional(),coordinateSystem:z.enum(['wgs84','gcj02']).optional(),photoIds:z.array(z.string()).max(5).default([]),note:z.string().trim().max(500).default('')}).parse(data);
      const s=await member(input.sessionId,user.id,tx);
      const previous=await one('SELECT id FROM checkins WHERE session_id=? AND user_id=?',[s.id,user.id],tx);
      if (previous) return {message:'你已成功打卡，无需重复提交',id:previous.id};
      const rules:Rules=JSON.parse(s.rules_json);
      if (period(s.date,rules,businessNow())!=='open') throw new Error(`当前不在打卡时间内（${rules.open}–${rules.close}）`);
      if (await one("SELECT id FROM leave_items WHERE session_id=? AND user_id=? AND status='approved'",[s.id,user.id],tx)) throw new Error('此场次请假已通过，请先联系管理员撤销请假');
      let location:{latitude:number;longitude:number;distance:number}|undefined;
      if(rules.locationRequired){
        if (!demoMode() && !rules.locationConfirmed && !(await settings(tx)).locationConfigured) throw new Error('管理员尚未确认实际打卡地点，请联系管理员');
        const loc=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().positive(),capturedAt:z.number(),coordinateSystem:z.enum(['wgs84','gcj02'])}).parse(input);
        location=checkLocation(rules,loc);
      }
      if(rules.photoRequired&&!input.photoIds.length) throw new Error('请按要求上传打卡照片');
      if(rules.noteRequired&&!input.note) throw new Error('请填写打卡备注');
      if(!(rules.photoEnabled??rules.photoRequired)&&input.photoIds.length)throw new Error('本场没有启用照片字段，请按本场要求提交');
      if(!(rules.noteEnabled??rules.noteRequired)&&input.note)throw new Error('本场没有启用备注字段，请按本场要求提交');
      await attachments(input.photoIds,'photo',user.id,tx);
      const id=crypto.randomUUID();
      await run('INSERT INTO checkins(id,session_id,user_id,submitted_at,latitude,longitude,accuracy,distance,captured_at,source_coords,photo_ids,note,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[
        id,s.id,user.id,businessNow(),location?.latitude??null,location?.longitude??null,input.accuracy??null,location?.distance??null,input.capturedAt??null,
        JSON.stringify({latitude:input.latitude,longitude:input.longitude,system:input.coordinateSystem}),JSON.stringify(input.photoIds),input.note,s.rules_json,s.version,
      ],tx);
      await run("UPDATE leave_items SET status='invalid',review_note='本人已完成打卡，此场次申请自动失效',reviewed_at=? WHERE session_id=? AND user_id=? AND status='pending'",[Date.now(),s.id,user.id],tx);
      await audit(user.id,'打卡成功',{session:s.date,distance:location?.distance},tx);
      return {message:'打卡成功，今晚也要保持专注',id};
    }
    if(action==='leave.create'){
      const input=z.object({sessionIds:z.array(z.string()).min(1).max(30),kind:z.enum(['personal','sick','free']),reason:z.string().trim().max(1000),proofIds:z.array(z.string()).max(5)}).parse(data);
      if(input.kind!=='free'&&input.reason.length<2) throw new Error('请填写请假原因');
      if(new Set(input.sessionIds).size!==input.sessionIds.length) throw new Error('请假场次重复');
      await attachments(input.proofIds,'proof',user.id,tx);
      const id=crypto.randomUUID();
      await run('INSERT INTO leaves(id,user_id,kind,reason,proof_ids,created_at) VALUES(?,?,?,?,?,?)',[id,user.id,input.kind,input.reason,JSON.stringify(input.proofIds),Date.now()],tx);
      for(const sessionId of input.sessionIds){
        const s=await member(sessionId,user.id,tx), rules:Rules=JSON.parse(s.rules_json);
        if(period(s.date,rules,businessNow())==='closed') throw new Error('已截止的场次不支持自行补请假，请联系管理员');
        if(rules.proofRequired[input.kind]&&!input.proofIds.length) throw new Error('该请假类型需要上传相关证明');
        if(await one('SELECT id FROM checkins WHERE session_id=? AND user_id=?',[s.id,user.id],tx)) throw new Error(`${s.date} 已完成打卡，无需请假`);
        if(await one("SELECT id FROM leave_items WHERE session_id=? AND user_id=? AND status IN ('pending','approved')",[s.id,user.id],tx)) throw new Error(`${s.date} 已有生效中的请假申请`);
        await run("INSERT INTO leave_items(id,leave_id,user_id,session_id,status) VALUES(?,?,?,?,'pending')",[crypto.randomUUID(),id,user.id,s.id],tx);
      }
      await run('INSERT INTO email_jobs(id,leave_id,next_attempt,created_at) VALUES(?,?,?,?)',[crypto.randomUUID(),id,Date.now(),Date.now()],tx);
      await audit(user.id,'提交请假',{id,kind:input.kind,sessions:input.sessionIds},tx);
      return {message:'请假已提交，可在申请记录中查看进度',id,mailJob:true};
    }
    if(action==='leave.withdraw'){
      const input=z.object({id:z.string()}).parse(data);
      if(!await one('SELECT id FROM leaves WHERE id=? AND user_id=?',[input.id,user.id],tx)) throw new HTTPError(403,'无法操作该申请');
      const result=await run("UPDATE leave_items SET status='withdrawn',reviewed_at=? WHERE leave_id=? AND status='pending'",[Date.now(),input.id],tx);
      if(!result.rowsAffected) throw new Error('此申请当前不能撤回');
      await audit(user.id,'撤回请假',{id:input.id},tx);return {message:'已撤回待审批的场次'};
    }
    if(action==='leave.review'){
      const input=z.object({id:z.string(),decision:z.enum(['approved','rejected','revoked']),note:z.string().trim().max(500)}).parse(data);
      if(input.decision!=='approved'&&!input.note) throw new Error('驳回或撤销需要填写原因');
      const items=await rows('SELECT * FROM leave_items WHERE leave_id=?',[input.id],tx);
      let changed=0;
      for(const item of items){
        if(input.decision==='revoked'?item.status!=='approved':item.status!=='pending') continue;
        let status=input.decision;
        if(status==='approved'&&await one('SELECT id FROM checkins WHERE session_id=? AND user_id=?',[item.session_id,item.user_id],tx)) throw new Error('学生已经打卡，请刷新后重新核对');
        await run('UPDATE leave_items SET status=?,review_note=?,reviewer_id=?,reviewed_at=? WHERE id=?',[status,input.note,user.id,Date.now(),item.id],tx);changed++;
      }
      if(!changed) throw new Error('申请状态已改变，请刷新后查看');
      await audit(user.id,'审批请假',input,tx);return {message:'审批结果已同步给学生'};
    }
    if(action==='settings.save'){
      const input=z.object({className:z.string().trim().min(1).max(40),adminEmails:z.array(z.email()).max(5),locationConfigured:z.boolean()}).parse(data);
      const previous=await settings(tx);
      await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...previous,...input}),],tx);
      await audit(user.id,'更新系统设置',input,tx);return {message:'系统设置已保存'};
    }
    if(action==='defaults.save'){
      const input=z.object({effectiveFrom:day,rules:rulesSchema}).parse(data);
      if(input.effectiveFrom<dateCN(businessNow()))throw new Error('默认规则不能追溯到过去日期');
      await run('INSERT INTO defaults_versions(id,effective_from,rules_json,created_at) VALUES(?,?,?,?)',[crypto.randomUUID(),input.effectiveFrom,JSON.stringify(input.rules),Date.now()],tx);
      const affected=await rows('SELECT * FROM sessions WHERE date>=? AND is_override=0',[input.effectiveFrom],tx);
      let count=0;
      for(const s of affected){
        if(period(s.date,JSON.parse(s.rules_json),businessNow())!=='before')continue;
        let applicable=await rulesFor(s.date,tx);
        if(s.recurrence_id){
          const source=await one('SELECT inherit_time FROM recurring_rules WHERE id=?',[s.recurrence_id],tx);
          if(!source?.inherit_time)continue;
          applicable={...JSON.parse(s.rules_json),open:applicable.open,close:applicable.close,studyStart:applicable.studyStart};
        }
        await run('UPDATE sessions SET rules_json=?,version=version+1 WHERE id=?',[JSON.stringify(applicable),s.id],tx);count++;
      }
      await audit(user.id,'更新默认规则',{...input,affected:count},tx);return {message:`默认配置已保存，更新 ${count} 个尚未开始的场次`};
    }
    if(action==='sessions.generate'){
      const input=z.object({from:day,to:day}).parse(data);
      if(input.from<dateCN(businessNow())||input.to<input.from||Date.parse(input.to)-Date.parse(input.from)>90*86400000)throw new Error('请选择从今天起、90 天以内的日期范围');
      let count=0;
      for(let d=input.from;d<=input.to;d=addDays(d,1)){
        const rule:Rules=await rulesFor(d,tx),weekday=new Date(d).getUTCDay();
        if(rule.weekdays.includes(weekday)&&!await one('SELECT id FROM sessions WHERE date=?',[d],tx)){await createSession(d,tx);count++;}
      }
      await audit(user.id,'生成打卡安排',{...input,count},tx);return {message:`已新增 ${count} 个打卡日期，已有安排保持不变`};
    }
    if(action==='session.save'){
      const input=z.object({date:day,rules:rulesSchema,reason:z.string().trim().min(2).max(200),cancelled:z.boolean().default(false),restore:z.boolean().default(false)}).parse(data);
      if(input.date<dateCN(businessNow()))throw new Error('不能修改历史场次');
      const old=await one('SELECT * FROM sessions WHERE date=?',[input.date],tx);
      const recurring=await resolveRecurringDate(input.date,tx);
      if(input.restore&&old?.term_id&&!recurring)throw new Error('该日目前没有启用的周期安排，请先补充周次规则，或保留为单日安排');
      const rule=input.restore?(recurring?.rules||await rulesFor(input.date,tx)):input.rules;
      if(old){await run('UPDATE sessions SET rules_json=?,is_override=?,cancelled=?,reason=?,term_id=?,recurrence_id=?,week_number=?,version=version+1 WHERE id=?',[JSON.stringify(rule),input.restore?0:1,input.cancelled?1:0,input.reason,recurring?.term.id||old.term_id||null,recurring?.rule.id||old.recurrence_id||null,recurring?.week||old.week_number||null,old.id],tx);}
      else {const id=await createSession(input.date,tx,rule,input.reason);await run('UPDATE sessions SET cancelled=?,is_override=?,term_id=?,recurrence_id=?,week_number=? WHERE id=?',[input.cancelled?1:0,input.restore?0:1,recurring?.term.id||null,recurring?.rule.id||null,recurring?.week||null,id],tx);}
      await audit(user.id,'临时调整安排',{date:input.date,before:old?JSON.parse(old.rules_json):null,after:rule,cancelled:input.cancelled,reason:input.reason},tx);
      return {message:'当天安排已发布，其他日期不受影响'};
    }
    if(action==='students.import'){
      const input=z.object({students:z.array(z.object({code:z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),name:z.string().trim().min(1).max(30)})).min(1).max(39)}).parse(data);
      const count=await one("SELECT COUNT(*) n FROM users WHERE role='student'",[],tx);
      const newCodes=[];
      for(const s of input.students){if(!await one('SELECT id FROM users WHERE code=?',[s.code],tx))newCodes.push(s.code);}
      if(Number(count.n)+new Set(newCodes).size>39)throw new Error('本班最多 39 名学生，请检查重复或错误的学号');
      if(new Set(input.students.map(s=>s.code)).size!==input.students.length)throw new Error('导入的学号重复');
      for(const s of input.students){
        const existing=await one('SELECT * FROM users WHERE code=?',[s.code],tx);
        if(existing){if(existing.role!=='student')throw new Error('学号与管理员账号冲突');await run('UPDATE users SET name=? WHERE id=?',[s.name,existing.id],tx);}
        else{const id=crypto.randomUUID();await run("INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,'student',?)",[id,s.code,s.name,Date.now()],tx);
          // 只将新学生加入尚未开始的未来场次。
          const future=await rows('SELECT * FROM sessions WHERE date>=?',[dateCN(businessNow())],tx);
          for(const s of future)if(period(s.date,JSON.parse(s.rules_json),businessNow())==='before')await run('INSERT OR IGNORE INTO session_members(session_id,user_id) VALUES(?,?)',[s.id,id],tx);
        }
      }
      await audit(user.id,'导入学生名单',{count:input.students.length},tx);return {message:`已保存 ${input.students.length} 名学生`};
    }
    if(action==='student.update'){
      const input=z.object({id:z.string(),code:z.string().transform(normalizeStudentCode).pipe(z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/)),name:z.string().trim().min(1).max(30)}).parse(data);
      const target=await one("SELECT id,code,name FROM users WHERE id=? AND role='student'",[input.id],tx);
      if(!target)throw new Error('学生不存在');
      await run('UPDATE users SET code=?,name=? WHERE id=?',[input.code,input.name,input.id],tx);
      await audit(user.id,'更正学生姓名与学号',{before:target,after:input},tx);
      return {message:'学生名单已更新，注册时将核对新的学号和姓名'};
    }
    if(action==='student.reset'){
      const input=z.object({id:z.string()}).parse(data);
      const target=await one("SELECT * FROM users WHERE id=? AND role='student'",[input.id],tx);
      if(!target)throw new Error('学生不存在');
      await run('UPDATE users SET openid=NULL,password_hash=NULL WHERE id=?',[input.id],tx);
      await run('DELETE FROM auth_sessions WHERE user_id=?',[input.id],tx);
      await audit(user.id,'核实后重置学生账号',{student:target.code},tx);
      return {message:'已重置账号，学生可使用名单中的学号和姓名重新注册；历史考勤保留'};
    }
    if(action==='attendance.manual'){
      const input=z.object({sessionId:z.string(),studentId:z.string(),reason:z.string().trim().min(4).max(500)}).parse(data);
      const s=await member(input.sessionId,input.studentId,tx);
      if(s.date>dateCN(businessNow()))throw new Error('尚未到来的场次不能提前补录签到');
      if(await one("SELECT id FROM leave_items WHERE session_id=? AND user_id=? AND status='approved'",[s.id,input.studentId],tx))throw new Error('请先撤销该场次已批准的请假');
      await run('INSERT INTO checkins(id,session_id,user_id,submitted_at,source_coords,note,rule_snapshot,rule_version) VALUES(?,?,?,?,?,?,?,?)',[crypto.randomUUID(),s.id,input.studentId,businessNow(),'manual',`管理员补录：${input.reason}`,s.rules_json,s.version],tx);
      await run("UPDATE leave_items SET status='invalid',review_note='管理员补录签到',reviewed_at=? WHERE session_id=? AND user_id=? AND status='pending'",[Date.now(),s.id,input.studentId],tx);
      await audit(user.id,'人工补录签到',input,tx);return {message:'已补录并保存操作原因'};
    }
    if(action==='email.retry'){
      const input=z.object({id:z.string()}).parse(data);
      const job=await one('SELECT * FROM email_jobs WHERE id=?',[input.id],tx);
      if(!job||job.status==='accepted')throw new Error('此通知不存在或已被邮件服务商接收');
      if(job.lease_until>Date.now())throw new Error('邮件正在发送，请稍后查看');
      await run("UPDATE email_jobs SET status='pending',attempts=0,next_attempt=?,lease_until=NULL WHERE id=?",[Date.now(),input.id],tx);
      await audit(user.id,'重试邮件',{id:input.id},tx);return {message:'已安排重试',mailJob:true};
    }
    throw new Error('不支持的操作');
  });
}

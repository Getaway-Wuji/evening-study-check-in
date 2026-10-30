import { z } from 'zod';
import type { InStatement } from '@libsql/client';
import { rows,one,run,settings,audit,businessNow,type Connection,type DBRow } from './db';
import { daySchema,rulesSchema } from './validation';
import { defaultRules,dateCN,period,type Rules } from './domain';
import { semesterDate,semesterWeek,rangesOverlap,resolveWeeklyRules,weekdayName,type AcademicTerm,type WeeklyRule } from './timetable-domain';

export async function readTimetable(c:Connection){
  const terms=(await rows('SELECT * FROM academic_terms ORDER BY first_monday DESC,created_at DESC',[],c)).map(t=>({id:t.id,name:t.name,firstMonday:t.first_monday,totalWeeks:t.total_weeks,weekdays:JSON.parse(t.weekdays_json),revision:t.revision,publishedRevision:t.published_revision}) as AcademicTerm);
  const recurring=(await rows('SELECT * FROM recurring_rules ORDER BY weekday,start_week,created_at',[],c)).map(r=>({id:r.id,termId:r.term_id,weekday:r.weekday,startWeek:r.start_week,endWeek:r.end_week,rules:JSON.parse(r.rules_json),inheritTime:!!r.inherit_time,enabled:!!r.enabled}) as WeeklyRule);
  return {terms,recurring};
}
export interface PlanEntry {date:string;week:number;weekday:number;action:'create'|'update'|'unchanged'|'protected'|'locked'|'cancel'|'gap'|'conflict';ruleId?:string;rules?:Rules;location:string;sessionId?:string;reason?:string}
export interface TermPlan {term:AcademicTerm;revision:number;entries:PlanEntry[];gaps:{date:string;week:number;weekday:number}[];errors:string[];counts:Record<PlanEntry['action'],number>}
export async function previewTerm(termId:string,c:Connection,now=businessNow()):Promise<TermPlan>{
  const {terms,recurring}=await readTimetable(c),term=terms.find(t=>t.id===termId);
  if(!term)throw new Error('学期不存在，请先设置学期起点');
  const allSessions=await rows('SELECT * FROM sessions',[],c);
  const versions=await rows('SELECT * FROM defaults_versions ORDER BY effective_from DESC,created_at DESC',[],c);
  const defaultsAt=(date:string):Rules=>{const v=versions.find(v=>v.effective_from<=date);return v?JSON.parse(v.rules_json):defaultRules;};
  const byDate=new Map(allSessions.map(s=>[s.date,s]));
  const enabled=recurring.filter(r=>r.termId===term.id&&r.enabled),entries:PlanEntry[]=[],gaps:TermPlan['gaps']=[],errors:string[]=[];
  for(let week=1;week<=term.totalWeeks;week++)for(const weekday of term.weekdays){
    const date=semesterDate(term.firstMonday,week,weekday),old=byDate.get(date),matches=enabled.filter(r=>r.weekday===weekday&&r.startWeek<=week&&r.endWeek>=week);
    const base=defaultsAt(date),rule=matches[0],resolved=rule?resolveWeeklyRules(rule,base):undefined;
    const entry:PlanEntry={date,week,weekday,action:'gap',ruleId:rule?.id,rules:resolved,location:resolved?.locationName||'尚未配置教室',sessionId:old?.id};
    if(date<dateCN(now)||period(date,old?JSON.parse(old.rules_json):resolved||base,now)!=='before'){entry.action='locked';if(old){entry.rules=JSON.parse(old.rules_json);entry.location=entry.rules!.locationName;}}
    else if(old?.is_override){entry.action='protected';entry.rules=JSON.parse(old.rules_json);entry.location=entry.rules!.locationName;entry.reason=old.cancelled?'保留当天临时停课':'保留当天临时调整';}
    else if(matches.length>1){entry.action='conflict';errors.push(`第 ${week} 周${weekdayName(weekday)}有重叠规则`);}
    else if(old?.term_id&&old.term_id!==term.id){entry.action='conflict';errors.push(`${date} 已被另一个学期使用`);}
    else if(!resolved){
      gaps.push({date,week,weekday});
      if(old?.term_id===term.id&&!old.cancelled){entry.action='cancel';entry.reason='该日已不在启用的周次规则内';}
    }else{
      if(resolved.locationRequired&&(!resolved.locationConfirmed||resolved.latitude===0&&resolved.longitude===0))errors.push(`第 ${week} 周${weekdayName(weekday)}的定位点尚未核对`);
      entry.action=!old?'create':old.cancelled||old.rules_json!==JSON.stringify(resolved)||old.recurrence_id!==rule.id?'update':'unchanged';
    }
    entries.push(entry);
  }
  // 学期星期设置缩减后，原先生成的未来场次也会在预览中列出取消。
  const dates=new Set(entries.map(e=>e.date));
  for(const old of allSessions.filter(s=>s.term_id===term.id&&!dates.has(s.date)&&!s.cancelled)){
    const week=semesterWeek(term,old.date)||Number(old.week_number)||1;
    if(old.is_override||period(old.date,JSON.parse(old.rules_json),now)!=='before')continue;
    entries.push({date:old.date,week,weekday:new Date(old.date).getUTCDay(),action:'cancel',sessionId:old.id,location:JSON.parse(old.rules_json).locationName,reason:'该日已不在学期安排内'});
  }
  entries.sort((a,b)=>a.date.localeCompare(b.date));
  const counts:TermPlan['counts']={create:0,update:0,unchanged:0,protected:0,locked:0,cancel:0,gap:0,conflict:0};
  entries.forEach(e=>counts[e.action]++);
  return {term,revision:term.revision,entries,gaps,errors:[...new Set(errors)],counts};
}
export async function resolveRecurringDate(date:string,c:Connection):Promise<{term:AcademicTerm;rule:WeeklyRule;rules:Rules;week:number}|null>{
  const config=await settings(c),{terms,recurring}=await readTimetable(c),term=terms.find(t=>t.id===config.currentTermId);
  if(!term)return null;
  const week=semesterWeek(term,date);if(!week)return null;
  const weekday=new Date(date).getUTCDay(),rule=recurring.find(r=>r.termId===term.id&&r.enabled&&r.weekday===weekday&&r.startWeek<=week&&r.endWeek>=week);
  if(!rule)return null;
  const v=await one('SELECT rules_json FROM defaults_versions WHERE effective_from<=? ORDER BY effective_from DESC,created_at DESC LIMIT 1',[date],c);
  return {term,rule,rules:resolveWeeklyRules(rule,v?JSON.parse(v.rules_json):defaultRules),week};
}
const termInput=z.object({id:z.string().optional(),name:z.string().trim().min(1).max(60),firstMonday:daySchema.refine(d=>new Date(d).getUTCDay()===1,'第 1 周起点必须是周一'),totalWeeks:z.number().int().min(1).max(60),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a=>new Set(a).size===a.length)});
const recurrenceInput=z.object({id:z.string().optional(),termId:z.string(),weekday:z.number().int().min(0).max(6),startWeek:z.number().int().min(1),endWeek:z.number().int().min(1),inheritTime:z.boolean().default(true),enabled:z.boolean().default(true),rules:rulesSchema});
async function validateRange(input:{id?:string;termId:string;weekday:number;startWeek:number;endWeek:number;enabled:boolean},c:Connection){
  const {terms,recurring}=await readTimetable(c),term=terms.find(t=>t.id===input.termId);
  if(!term)throw new Error('请先设置学期');
  if(input.startWeek>input.endWeek||input.endWeek>term.totalWeeks)throw new Error(`周次应在第 1–${term.totalWeeks} 周内，开始周不能晚于结束周`);
  if(!term.weekdays.includes(input.weekday))throw new Error('这个星期尚未列入本学期晚自习日期，请先编辑学期');
  if(input.enabled&&recurring.some(r=>r.id!==input.id&&r.termId===input.termId&&r.enabled&&rangesOverlap(r,input)))throw new Error('同一个星期的周次范围有重叠，请修改已有规则或调整起止周');
  return term;
}
export async function timetableCommand(user:DBRow,action:string,data:unknown,c:Connection):Promise<Record<string,any>>{
  if(action==='term.save'){
    const input=termInput.parse(data),id=input.id||crypto.randomUUID(),old=input.id?await one('SELECT * FROM academic_terms WHERE id=?',[id],c):undefined;
    if(input.id&&!old)throw new Error('学期不存在');
    if(old&&(old.first_monday!==input.firstMonday||old.total_weeks!==input.totalWeeks)&&await one('SELECT id FROM sessions WHERE term_id=? LIMIT 1',[id],c))throw new Error('已发布学期的周次起点和总周数不能直接改动，请新建学期，避免历史周次错位');
    if(old&&await one(`SELECT id FROM recurring_rules WHERE term_id=? AND enabled=1 AND weekday NOT IN (${input.weekdays.map(()=>'?').join(',')}) LIMIT 1`,[id,...input.weekdays],c))throw new Error('请先停用被移除星期的周次规则，再调整学期星期');
    await run('INSERT INTO academic_terms(id,name,first_monday,total_weeks,weekdays_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,first_monday=excluded.first_monday,total_weeks=excluded.total_weeks,weekdays_json=excluded.weekdays_json,revision=academic_terms.revision+1',[id,input.name,input.firstMonday,input.totalWeeks,JSON.stringify(input.weekdays),Date.now()],c);
    const config=await settings(c);await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...config,currentTermId:id})],c);
    await audit(user.id,'设置学期周次',input,c);return {message:'学期已保存，请按星期添加各段周次的教室',id};
  }
  if(action==='term.select'){
    const {id}=z.object({id:z.string()}).parse(data);if(!await one('SELECT id FROM academic_terms WHERE id=?',[id],c))throw new Error('学期不存在');
    const config=await settings(c);await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...config,currentTermId:id})],c);await audit(user.id,'切换当前学期',{id},c);return {message:'当前学期已切换'};
  }
  if(action==='recurrence.save'){
    const input=recurrenceInput.parse(data);await validateRange(input,c);
    if(input.id&&!await one('SELECT id FROM recurring_rules WHERE id=? AND term_id=?',[input.id,input.termId],c))throw new Error('周次规则不存在');
    const id=input.id||crypto.randomUUID();
    await run('INSERT INTO recurring_rules(id,term_id,weekday,start_week,end_week,rules_json,inherit_time,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET weekday=excluded.weekday,start_week=excluded.start_week,end_week=excluded.end_week,rules_json=excluded.rules_json,inherit_time=excluded.inherit_time,enabled=excluded.enabled',[id,input.termId,input.weekday,input.startWeek,input.endWeek,JSON.stringify(input.rules),input.inheritTime?1:0,input.enabled?1:0,Date.now()],c);
    await run('UPDATE academic_terms SET revision=revision+1 WHERE id=?',[input.termId],c);
    await audit(user.id,'设置星期与周次教室',{id,...input},c);return {message:'周次规则已保存，预览并发布后更新学生安排',id};
  }
  if(action==='recurrence.toggle'){
    const input=z.object({id:z.string(),enabled:z.boolean()}).parse(data),old=await one('SELECT * FROM recurring_rules WHERE id=?',[input.id],c);
    if(!old)throw new Error('周次规则不存在');
    await validateRange({id:old.id,termId:old.term_id,weekday:old.weekday,startWeek:old.start_week,endWeek:old.end_week,enabled:input.enabled},c);
    await run('UPDATE recurring_rules SET enabled=? WHERE id=?',[input.enabled?1:0,input.id],c);await run('UPDATE academic_terms SET revision=revision+1 WHERE id=?',[old.term_id],c);
    await audit(user.id,input.enabled?'启用周次规则':'停用周次规则',input,c);return {message:'规则状态已保存，请预览并发布新的安排'};
  }
  if(action==='term.preview'){
    const {id}=z.object({id:z.string()}).parse(data);return {message:'已生成实际日期预览，尚未修改学生安排',plan:await previewTerm(id,c)};
  }
  if(action==='term.publish'){
    const input=z.object({id:z.string(),revision:z.number().int(),allowGaps:z.boolean().default(false)}).parse(data),plan=await previewTerm(input.id,c);
    if(plan.revision!==input.revision)throw new Error('规则已发生变化，请重新预览后发布');
    if(plan.errors.length)throw new Error(plan.errors[0]);
    if(plan.gaps.length&&!input.allowGaps)throw new Error('仍有周次未配置教室，请补齐，或明确确认仅发布已配置日期');
    const statements:InStatement[]=[];
    for(const e of plan.entries){
      if(e.action==='create'){
        const id=crypto.randomUUID();
        statements.push({sql:'INSERT INTO sessions(id,date,rules_json,is_override,term_id,recurrence_id,week_number,created_at) VALUES(?,?,?,0,?,?,?,?)',args:[id,e.date,JSON.stringify(e.rules),plan.term.id,e.ruleId!,e.week,Date.now()]});
        statements.push({sql:"INSERT INTO session_members(session_id,user_id) SELECT ?,id FROM users WHERE role='student' AND active=1",args:[id]});
      }else if(e.action==='update'){
        statements.push({sql:'UPDATE sessions SET rules_json=?,term_id=?,recurrence_id=?,week_number=?,cancelled=0,version=version+1 WHERE id=?',args:[JSON.stringify(e.rules),plan.term.id,e.ruleId!,e.week,e.sessionId!]});
      }else if(e.action==='cancel'){
        statements.push({sql:"UPDATE sessions SET cancelled=1,reason='周期安排调整后取消',version=version+1 WHERE id=?",args:[e.sessionId!]});
        statements.push({sql:"UPDATE leave_items SET status='invalid',review_note='该晚自习场次已取消',reviewer_id=?,reviewed_at=? WHERE session_id=? AND status IN ('pending','approved')",args:[user.id,Date.now(),e.sessionId!]});
      }
    }
    if(statements.length)await c.batch(statements);
    await run('UPDATE academic_terms SET published_revision=revision WHERE id=?',[input.id],c);
    await audit(user.id,'发布学期周期安排',{termId:input.id,counts:plan.counts,unconfigured:plan.gaps.length},c);
    return {message:`已新增 ${plan.counts.create} 个、更新 ${plan.counts.update} 个安排，保留 ${plan.counts.protected} 个临时调整`,counts:plan.counts};
  }
  throw new Error('不支持的学期操作');
}

import { addDays,validDate,type Rules } from './domain';
export interface AcademicTerm {id:string;name:string;firstMonday:string;totalWeeks:number;weekdays:number[];revision:number;publishedRevision:number}
export interface WeeklyRule {id:string;termId:string;weekday:number;startWeek:number;endWeek:number;rules:Rules;inheritTime:boolean;enabled:boolean}
export const weekdayName=(n:number)=>['周日','周一','周二','周三','周四','周五','周六'][n];
export function semesterDate(firstMonday:string,week:number,weekday:number){
  if(!validDate(firstMonday)||new Date(firstMonday).getUTCDay()!==1||!Number.isInteger(week)||week<1||weekday<0||weekday>6)throw new Error('学期起点必须是第 1 周周一，周次与星期需有效');
  return addDays(firstMonday,(week-1)*7+(weekday+6)%7);
}
export function semesterWeek(term:Pick<AcademicTerm,'firstMonday'|'totalWeeks'>,date:string){
  const week=Math.floor((Date.parse(date)-Date.parse(term.firstMonday))/604800000)+1;
  return week>=1&&week<=term.totalWeeks?week:null;
}
export function rangesOverlap(a:Pick<WeeklyRule,'weekday'|'startWeek'|'endWeek'>,b:Pick<WeeklyRule,'weekday'|'startWeek'|'endWeek'>){return a.weekday===b.weekday&&a.startWeek<=b.endWeek&&b.startWeek<=a.endWeek;}
export function resolveWeeklyRules(rule:WeeklyRule,defaults:Rules):Rules{
  return {...rule.rules,...(rule.inheritTime?{open:defaults.open,close:defaults.close,studyStart:defaults.studyStart}:{})};
}

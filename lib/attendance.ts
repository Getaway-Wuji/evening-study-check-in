import {period} from './domain';
import type {bootstrap} from './service';
type Data=Awaited<ReturnType<typeof bootstrap>>;

export function exemptionFor(d:Pick<Data,'exemptions'>,userId:string,date:string){
  return d.exemptions?.find(e=>e.user_id===userId&&e.cancelled_at===null&&e.starts_on<=date&&(!e.ends_on||e.ends_on>=date));
}
export function studentState(d:Data,s:Data['sessions'][number]|undefined,userId:string){
  if(!s||s.cancelled)return {key:'none',label:'无打卡安排',tone:'neutral'};
  const c=d.checkins.find(x=>x.user_id===userId&&x.session_id===s.id);
  if(c)return {key:'checked',label:c.method==='makeup'?'人工补签':c.method==='manual'?'补录签到':'已打卡',tone:'green',record:c};
  const items=d.leaves.filter(x=>x.user_id===userId).flatMap(x=>x.items).filter(x=>x.session_id===s.id);
  if(items.some(x=>x.status==='approved'))return {key:'leave',label:'已请假',tone:'blue'};
  if(exemptionFor(d,userId,s.date))return {key:'exempt',label:'免打卡',tone:'blue'};
  if(items.some(x=>x.status==='pending'))return {key:'review',label:'请假待审批',tone:'orange'};
  if(d.makeups.some(m=>m.user_id===userId&&m.session_id===s.id&&m.status==='pending'))return {key:'makeup',label:'补签待审核',tone:'orange'};
  const p=period(s.date,s.rules,d.now);return {key:p==='closed'?'absent':'waiting',label:p==='closed'?'缺勤':p==='before'?'待开始':'待打卡',tone:p==='closed'?'red':'neutral'};
}
export function sessionStats(d:Data,s:Data['sessions'][number]|undefined){
  const members=s&&!s.cancelled?d.members.filter(x=>x.session_id===s.id):[],states=members.map(x=>studentState(d,s,x.user_id));
  const exempt=states.filter(x=>x.key==='exempt').length;
  return {total:members.length-exempt,exempt,checked:states.filter(x=>x.key==='checked').length,leave:states.filter(x=>x.key==='leave').length,pending:states.filter(x=>x.key==='review').length,makeup:states.filter(x=>x.key==='makeup').length,waiting:states.filter(x=>x.key==='waiting').length,absent:states.filter(x=>x.key==='absent').length};
}

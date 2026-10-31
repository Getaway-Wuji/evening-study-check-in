'use client';
import Link from 'next/link';
import {useState} from 'react';
import {CalendarDays,ArrowRight} from 'lucide-react';
import {useStore} from './store';
import {Button,Badge} from './common';
import {weekdayName,type AcademicTerm} from '@/lib/timetable-domain';

export default function WeeklyDays(){
  const {d}=useStore(),term=d.terms.find(t=>t.id===d.settings.currentTermId)||d.terms[0];
  return <section className="card weekly-days-card" id="weekly-days">
    <div className="card-heading"><h2><CalendarDays size={19}/>每周哪些天晚自习</h2><Badge tone="blue">{term?`每周 ${term.weekdays.length} 天`:'尚未设置'}</Badge></div>
    {term?<WeeklyDaysForm key={`${term.id}-${term.revision}`} term={term}/>:<div className="weekly-days-body"><p>先填写学期起点和总周数，再自行选择周一至周日中的任意星期。</p><Link className="button" href="/admin/schedule">前往设置学期<ArrowRight size={16}/></Link></div>}
  </section>;
}
function WeeklyDaysForm({term}:{term:AcademicTerm}){
  const {act,busy}=useStore(),[days,setDays]=useState(term.weekdays),[error,setError]=useState('');
  const changed=days.length!==term.weekdays.length||days.some(n=>!term.weekdays.includes(n));
  const removed=term.weekdays.some(n=>!days.includes(n));
  return <form className="weekly-days-body form-stack" onSubmit={async e=>{e.preventDefault();if(!days.length){setError('请至少选择一天晚自习');return;}await act('term.weekdays',{id:term.id,revision:term.revision,weekdays:days});}}>
    <p>{term.name} · 勾选本班每周需要晚自习的星期，天数随选择自动计算。</p>
    <fieldset className="weekly-days-options"><legend className="sr-only">每周晚自习星期</legend>{[1,2,3,4,5,6,0].map(n=><label key={n} className={`weekday-choice ${days.includes(n)?'selected':''}`}><input type="checkbox" value={n} checked={days.includes(n)} onChange={e=>{setError('');setDays(old=>e.target.checked?[...old,n]:old.filter(x=>x!==n));}}/>{weekdayName(n)}</label>)}</fieldset>
    <div className="weekly-days-status" aria-live="polite">{days.length?`已选 ${days.length} 天：${[1,2,3,4,5,6,0].filter(n=>days.includes(n)).map(weekdayName).join('、')}`:'尚未选择星期'}</div>
    {removed&&<p className="inline-note">移除星期后，对应周次规则会停用；重新勾选时可手动启用原规则。预览发布会列出将取消的未来场次，保留历史和单日临时调整。</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="weekly-days-actions"><Button variant="primary" busy={busy} disabled={!changed||!days.length}>保存每周星期</Button><Link className="text-link" href="/admin/schedule#weekly-classrooms">安排教室与预览发布<ArrowRight size={15}/></Link></div>
    <p className="field-hint">{term.publishedRevision===term.revision?'保存后需预览发布才更新学生端。':'当前有尚未发布的安排，请到打卡安排中预览并发布日期。'}</p>
  </form>;
}

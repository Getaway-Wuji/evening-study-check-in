'use client';
import {useState,type FormEvent} from 'react';
import {useStore} from './store';
import {Button,Badge,Dialog} from './common';
import {dateCN} from '@/lib/domain';
import {exemptionFor} from '@/lib/attendance';
import styles from './student-exemptions.module.css';

export function AttendanceRequirement({studentId}:{studentId:string}){
  const {d}=useStore(),today=dateCN(d.now),current=exemptionFor(d,studentId,today);
  const upcoming=d.exemptions.some(e=>e.user_id===studentId&&e.cancelled_at===null&&e.starts_on>today);
  return <Badge tone={current||upcoming?'blue':'neutral'}>{current?'免打卡':upcoming?'已预约免打卡':'正常打卡'}</Badge>;
}
export default function StudentExemptions({student,onClose}:{student:{id:string;name:string;code:string};onClose:()=>void}){
  const {d,act,busy}=useStore(),today=dateCN(d.now);
  const [startsOn,setStartsOn]=useState(today),[endsOn,setEndsOn]=useState(''),[reason,setReason]=useState('');
  const records=d.exemptions.filter(e=>e.user_id===student.id);
  async function save(event:FormEvent){
    event.preventDefault();
    if(await act('exemption.create',{studentId:student.id,startsOn,endsOn:endsOn||null,reason})){setReason('');setEndsOn('');}
  }
  return <Dialog title={`${student.name} · 免打卡设置`} onClose={onClose}>
    <p className="muted">学号 {student.code}。免打卡期间不计缺勤，无需请假或补签；已完成的打卡和已批准请假记录继续保留。</p>
    {records.length>0&&<section className={styles.records} aria-label="免打卡记录">{records.map(record=>{
      const ended=record.cancelled_at!==null||record.ends_on&&record.ends_on<today,future=record.starts_on>today;
      return <article className={styles.record} key={record.id}><div className={styles.heading}><strong>{record.starts_on} 至 {record.ends_on||'长期'}</strong><Badge tone={ended?'neutral':'blue'}>{record.cancelled_at!==null?'已取消':ended?'已结束':future?'待生效':'生效中'}</Badge></div>{record.reason&&<p>{record.reason}</p>}{!ended&&<Button type="button" busy={busy} onClick={()=>void act('exemption.end',{id:record.id})}>{future?'取消此免打卡安排':'从今天恢复打卡'}</Button>}</article>;
    })}<p className="field-hint">恢复后，今天也需要按时打卡；若已截止，请核实到场情况后处理。之前日期的免打卡记录保留。</p></section>}
    <form className="form-stack" onSubmit={save}><h3>新增免打卡时段</h3>
      <div className={styles.dates}><label>开始日期<input type="date" value={startsOn} min={today} required onChange={e=>setStartsOn(e.target.value)}/></label><label>结束日期（选填）<input type="date" value={endsOn} min={startsOn} onChange={e=>setEndsOn(e.target.value)}/></label></div>
      <p className="field-hint">开始和结束当天均免打卡，结束日期留空表示长期有效。适用于期间所有已发布及之后新增的晚自习场次。</p>
      <label>原因或备注（选填，学生本人可见）<textarea maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：参加学校统一安排的培训"/></label>
      <p className="field-hint">保存后，该时段尚未审批的请假和补签申请会标为已失效，证明材料仍会保留。</p>
      <Button variant="primary full" busy={busy}>保存免打卡设置</Button>
    </form>
  </Dialog>;
}

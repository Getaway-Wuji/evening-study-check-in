'use client';
import {useState} from 'react';
import {Plus,Settings2} from 'lucide-react';
import {useStore} from './store';
import {Button} from './common';
import type {ClassPolicy} from '@/lib/class-policy';
import styles from './policy-settings.module.css';

export default function PolicySettings(){
  const {d,act,busy}=useStore(),[draft,setDraft]=useState<ClassPolicy>(()=>structuredClone(d.settings.policy));
  const [retryMinutes,setRetryMinutes]=useState(draft.notifications.retryMinutes.join(', '));
  const leaveNumber=(key:'maxSessions'|'reasonMinLength'|'reasonMaxLength'|'advanceMinutes',value:number)=>setDraft(p=>({...p,leave:{...p.leave,[key]:value}}));
  const uploadNumber=(key:'photoMaxFiles'|'proofMaxFiles'|'photoMaxMB'|'proofMaxMB',value:number)=>setDraft(p=>({...p,uploads:{...p.uploads,[key]:value}}));
  function updateType(index:number,values:Partial<ClassPolicy['leaveTypes'][number]>){setDraft(p=>({...p,leaveTypes:p.leaveTypes.map((t,i)=>i===index?{...t,...values}:t)}));}
  return <section className={`card ${styles.panel}`}>
    <div className="card-heading"><h2>班级业务规则</h2><Settings2 size={19}/></div>
    <form className="form-stack" onSubmit={async e=>{e.preventDefault();await act('policy.save',{...draft,notifications:{...draft.notifications,retryMinutes:retryMinutes.split(/[,，;；\s]+/).filter(Boolean).map(Number)}});}}>
      <div className="policy-section">
        <div className="policy-title"><h3>请假类型与要求</h3><Button type="button" disabled={draft.leaveTypes.length>=30} onClick={()=>setDraft(p=>({...p,leaveTypes:[...p.leaveTypes,{id:'type_'+crypto.randomUUID().replaceAll('-',''),name:'',enabled:true,reasonRequired:true,proofRequired:true}]}))}><Plus size={15}/>添加请假类型</Button></div>
        <p className="field-hint">可以修改名称或停用类型，已有申请保留提交时的名称。“默认需证明”用于未单独设置此类型的场次；已设置的场次以“打卡安排”中的证明要求为准。</p>
        <div className="table-scroll"><table><thead><tr><th>类型名称</th><th>启用</th><th>说明必填</th><th>默认需证明</th><th>操作</th></tr></thead><tbody>{draft.leaveTypes.map((type,index)=><tr key={type.id}>
          <td><input aria-label={`请假类型名称 ${index+1}`} value={type.name} required maxLength={30} placeholder="填写类型名称" onChange={e=>updateType(index,{name:e.target.value})}/></td>
          <td><input aria-label={`${type.name||'未命名类型'} 启用`} type="checkbox" checked={type.enabled} onChange={e=>updateType(index,{enabled:e.target.checked})}/></td>
          <td><input aria-label={`${type.name||'未命名类型'} 说明必填`} type="checkbox" checked={type.reasonRequired} onChange={e=>updateType(index,{reasonRequired:e.target.checked})}/></td>
          <td><input aria-label={`${type.name||'未命名类型'} 默认需证明`} type="checkbox" checked={type.proofRequired} onChange={e=>updateType(index,{proofRequired:e.target.checked})}/></td>
          <td>{d.settings.policy.leaveTypes.some(t=>t.id===type.id)?<span className="tiny muted">可停用</span>:<button type="button" className="text-link" onClick={()=>setDraft(p=>({...p,leaveTypes:p.leaveTypes.filter(t=>t.id!==type.id)}))}>移除此新增项</button>}</td>
        </tr>)}</tbody></table></div>
      </div>
      <div className="policy-grid">
        <div className="policy-section"><h3>定位失败后的人工补签</h3><label className="check-label"><input type="checkbox" checked={draft.makeup.enabled} onChange={e=>setDraft(p=>({...p,makeup:{...p.makeup,enabled:e.target.checked}}))}/>允许学生上传现场照片和说明申请补签</label><label>正常打卡截止后允许申请的小时数<input type="number" required min={1} max={720} value={draft.makeup.hoursAfterClose} onChange={e=>setDraft(p=>({...p,makeup:{...p.makeup,hoursAfterClose:+e.target.value}}))}/></label><p className="field-hint">申请从本场打卡开放时开始接受，现场照片必填，数量与大小沿用打卡照片限制。审核通过才计入出勤；关闭入口或超过申请期限不影响已提交申请的审核。</p></div>
        <div className="policy-section"><h3>请假提交规则</h3><div className="form-grid">
          <label>单次最多请假场数<input type="number" required min={1} max={366} value={draft.leave.maxSessions} onChange={e=>leaveNumber('maxSessions',+e.target.value)}/></label>
          <label>必填说明最少字数<input type="number" required min={1} max={5000} value={draft.leave.reasonMinLength} onChange={e=>leaveNumber('reasonMinLength',+e.target.value)}/></label>
          <label>请假说明最多字数<input type="number" required min={draft.leave.reasonMinLength} max={5000} value={draft.leave.reasonMaxLength} onChange={e=>leaveNumber('reasonMaxLength',+e.target.value)}/></label>
          <label>请假截止基准<select value={draft.leave.deadline} onChange={e=>setDraft(p=>({...p,leave:{...p.leave,deadline:e.target.value as ClassPolicy['leave']['deadline']}}))}><option value="open">开始打卡</option><option value="studyStart">晚自习开始</option><option value="close">打卡截止分钟结束</option></select></label>
          <label>需提前多少分钟请假<input type="number" required min={0} max={10080} value={draft.leave.advanceMinutes} onChange={e=>leaveNumber('advanceMinutes',+e.target.value)}/></label>
          <label>打卡备注最多字数<input type="number" required min={1} max={2000} value={draft.noteMaxLength} onChange={e=>setDraft(p=>({...p,noteMaxLength:+e.target.value}))}/></label>
        </div><p className="field-hint">提前分钟数填 0 表示允许申请到所选截止基准。设置会影响后续提交，不改变已提交申请和审批结果。</p></div>
        <div className="policy-section"><h3>照片与证明</h3><div className="form-grid">
          <label>打卡照片最多文件数<input type="number" required min={1} max={20} value={draft.uploads.photoMaxFiles} onChange={e=>uploadNumber('photoMaxFiles',+e.target.value)}/></label>
          <label>每个打卡照片最大 MB<input type="number" required min={1} max={10} value={draft.uploads.photoMaxMB} onChange={e=>uploadNumber('photoMaxMB',+e.target.value)}/></label>
          <label>请假证明最多文件数<input type="number" required min={1} max={20} value={draft.uploads.proofMaxFiles} onChange={e=>uploadNumber('proofMaxFiles',+e.target.value)}/></label>
          <label>每个请假证明最大 MB<input type="number" required min={1} max={10} value={draft.uploads.proofMaxMB} onChange={e=>uploadNumber('proofMaxMB',+e.target.value)}/></label>
        </div><label className="check-label"><input type="checkbox" checked={draft.uploads.proofPdfEnabled} onChange={e=>setDraft(p=>({...p,uploads:{...p.uploads,proofPdfEnabled:e.target.checked}}))}/>请假证明允许 PDF</label><p className="field-hint">照片支持 JPG、PNG。是否收集照片、定位和备注，以及各场次是否必须提供证明，继续在“打卡安排”中设置。</p></div>
        <div className="policy-section"><h3>管理员邮件通知</h3><label className="check-label"><input type="checkbox" checked={draft.notifications.enabled} onChange={e=>setDraft(p=>({...p,notifications:{...p.notifications,enabled:e.target.checked}}))}/>学生提交请假后通知管理员邮箱</label><div className="form-grid">
          <label>自动发送最多尝试次数<input type="number" required min={1} max={10} value={draft.notifications.maxAttempts} onChange={e=>setDraft(p=>({...p,notifications:{...p.notifications,maxAttempts:+e.target.value}}))}/></label>
          <label>失败后重试间隔（分钟）<input required value={retryMinutes} onChange={e=>setRetryMinutes(e.target.value)} placeholder="多个间隔用逗号分隔"/></label>
        </div><p className="field-hint">间隔列表用完后沿用最后一个间隔。发件服务、自动调度需由部署者配置；收件邮箱在上方填写。关闭通知不影响请假申请保存。</p></div>
        <div className="policy-section"><h3>给本班学生的说明</h3><label>班级说明或联系办法<textarea value={draft.studentNotice} maxLength={2000} rows={5} onChange={e=>setDraft(p=>({...p,studentNotice:e.target.value}))} placeholder="可填写本班考勤要求、特殊情况处理方式或管理员联系方式"/></label><p className="field-hint">显示在登录后的学生打卡页和请假页，留空则不显示。</p></div>
      </div>
      <Button variant="primary" busy={busy}>保存班级业务规则</Button>
    </form>
  </section>;
}

'use client';
import {useState} from 'react';
import {FileText} from 'lucide-react';
import {useStore} from './store';
import {Button} from './common';
import styles from './leave-proof-guidance.module.css';

export default function LeaveProofGuidance(){
  const {d,act,busy}=useStore(),[text,setText]=useState(d.settings.leaveProofGuidance||'');
  return <section className={`card ${styles.panel}`} id="leave-proof-guidance">
    <div className="card-heading"><h2>请假材料上传提示</h2><FileText size={19}/></div>
    <form className="form-stack" onSubmit={async e=>{e.preventDefault();await act('settings.proofGuidance.save',{text});}}>
      <label>学生上传材料时看到的提示<textarea rows={5} value={text} maxLength={2000} onChange={e=>setText(e.target.value)} placeholder={'例如：请同时上传已向辅导员说明请假情况的聊天截图，以及请假说明图片。'}/></label>
      <p className="field-hint">保存后显示在学生请假页的证明上传按钮上方，支持换行，最多 2000 字。留空并保存即可隐藏提示。此处只设置说明文字；材料是否必交、数量和格式仍按现有规则执行。</p>
      {!!text.trim()&&<div className={styles.preview} aria-label="学生端提示预览"><strong>学生端显示预览</strong><p>{text.trim()}</p></div>}
      <Button variant="primary" busy={busy}>保存材料提示</Button>
    </form>
  </section>;
}

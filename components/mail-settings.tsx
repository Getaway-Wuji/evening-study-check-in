'use client';
import {useEffect,useState} from 'react';
import {Mail,Send,RefreshCw} from 'lucide-react';
import {api,Button,Badge} from './common';
import type {mailStatus} from '@/lib/mail-settings';
type Status=Awaited<ReturnType<typeof mailStatus>>;
export default function MailSettings(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[testId,setTestId]=useState('');
  useEffect(()=>{let active=true;api('/api/mail/status').then(value=>{if(active)setStatus(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:'邮件设置读取失败');});return()=>{active=false;};},[]);
  async function refresh(){setError('');try{setStatus(await api('/api/mail/status'));}catch(error){setError(error instanceof Error?error.message:'读取失败');}}
  async function test(){setBusy(true);setError('');setMessage('');const id=testId||crypto.randomUUID();setTestId(id);try{const result=await api('/api/mail/status',{id});setMessage(result.message);await refresh();}catch(error){setError(error instanceof Error?error.message:'测试发送失败');}finally{setBusy(false);}}
  const configured=!!(status?.serviceConfigured&&status.sender&&status.recipients.length);
  return <section className="card mail-setup-card" id="mail-setup"><div className="card-heading"><h2><Mail size={20}/>请假邮件通知</h2><Button onClick={refresh} type="button"><RefreshCw size={16}/>刷新连接状态</Button></div><div className="mail-setup-body">
    <div className="mail-setup-status"><div><strong>发信服务</strong><Badge tone={configured?'blue':'neutral'}>{configured?'配置已填，待收信验证':'尚未配置完整'}</Badge></div><div><strong>发件人</strong><span>{status?.sender||'尚未设置发件地址'}</span></div><div><strong>管理员收件人</strong><span>{status?.recipients.join('、')||'请在上方填写并保存收件邮箱'}</span></div><div><strong>自动重试</strong><span>{status?.schedulerConfigured?'已配置自动调度':'尚未接通调度，可在通知中心手动重试'}</span></div></div>
    <p>每份通知包含学生姓名和学号、请假类别、具体原因、请假场次及证明材料。普通图片和 PDF 直接附在邮件中；超过邮件体积预算的材料提供需登录后台的原件链接。</p>
    {!status?.enabled&&<p className="inline-note">本班已关闭自动邮件通知。测试邮件仍可单独发送，不会改变通知开关。</p>}
    <div className="mail-test-box"><strong>发送一封完整的测试邮件</strong><p>发给上方已保存的管理员邮箱，使用虚构学生、测试原因和 PNG 图片，不会新增真实请假记录。请同时检查收件箱和垃圾邮件。</p><Button variant="primary" busy={busy} disabled={!configured||!!message} onClick={test}><Send size={16}/>发送测试邮件（含图片）</Button>{message&&<p role="status" className="inline-note">{message}</p>}{status?.lastTest?.provider_id&&<p className="field-hint">最近测试已被邮件服务商接收。服务商编号：{String(status.lastTest.provider_id)}；实际是否收到请以管理员邮箱为准。</p>}</div>
    {error&&<p className="form-error" role="alert">{error}</p>}
  </div></section>;
}

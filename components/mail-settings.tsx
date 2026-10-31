'use client';
import {useEffect,useState} from 'react';
import {Mail,Send,RefreshCw} from 'lucide-react';
import {api,Button,Badge} from './common';
import type {mailStatus} from '@/lib/mail-settings';
type Status=Awaited<ReturnType<typeof mailStatus>>;
const retryLabels:Record<string,string>={queued:'等待回调',retry:'已模拟失败，等待自动重试',sending:'正在自动发送',accepted:'自动重试成功，服务商已接收邮件',failed:'测试失败，请检查连接后重试'};
export default function MailSettings(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[testId,setTestId]=useState('');
  const [retryBusy,setRetryBusy]=useState(false),[retryMessage,setRetryMessage]=useState(''),[retryTestId,setRetryTestId]=useState(''),[retryStarted,setRetryStarted]=useState(false);
  useEffect(()=>{let active=true;api('/api/mail/status').then(value=>{if(active)setStatus(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:'邮件设置读取失败');});return()=>{active=false;};},[]);
  async function refresh(){setError('');try{setStatus(await api('/api/mail/status'));}catch(error){setError(error instanceof Error?error.message:'读取失败');}}
  async function test(){setBusy(true);setError('');setMessage('');const id=testId||crypto.randomUUID();setTestId(id);try{const result=await api('/api/mail/status',{id});setMessage(result.message);await refresh();}catch(error){setError(error instanceof Error?error.message:'测试发送失败');}finally{setBusy(false);}}
  async function retryAction(action:'setup'|'test'){
    setRetryBusy(true);setError('');try{const id=retryTestId||crypto.randomUUID();if(action==='test')setRetryTestId(id);const result=await api('/api/mail/retry',{action,...(action==='test'?{id}:{})});if(action==='test')setRetryStarted(true);setRetryMessage(result.message);await refresh();}catch(error){setError(error instanceof Error?error.message:'调度操作失败');}finally{setRetryBusy(false);}
  }
  const retryState=status?.lastRetryTest?.status,retryId=status?.lastRetryTest?.id;
  useEffect(()=>{if(!retryId||!['queued','retry','sending'].includes(String(retryState)))return;let active=true;const timer=setInterval(()=>{api('/api/mail/status').then(value=>{if(active)setStatus(value);}).catch(()=>{});},5000);return()=>{active=false;clearInterval(timer);};},[retryId,retryState]);
  const configured=!!(status?.serviceConfigured&&status.sender&&status.recipients.length);
  return <section className="card mail-setup-card" id="mail-setup">
    <div className="card-heading"><h2><Mail size={20}/>请假邮件通知</h2><Button onClick={refresh} type="button"><RefreshCw size={16}/>刷新连接状态</Button></div>
    <div className="mail-setup-body">
      <div className="mail-setup-status">
        <div><strong>发信服务</strong><Badge tone={configured?'blue':'neutral'}>{status===null?'正在读取':configured?status.lastTest?.provider_id?'测试请求已接收':'配置已填，待收信验证':'尚未配置完整'}</Badge></div>
        <div><strong>发件人</strong><span>{status?.sender||'尚未设置发件地址'}</span></div>
        <div><strong>管理员收件人</strong><span>{status?.recipients.join('、')||'请在上方填写并保存收件邮箱'}</span></div>
        <div><strong>自动重试</strong><span>{status?.schedulerConfigured?status.recovery?'已配置自动调度与定时检查':'已配置自动调度，待建立定时检查':'尚未接通调度，可在通知中心手动重试'}</span></div>
      </div>
      <p>每份通知包含学生姓名和学号、请假类别、具体原因、请假场次及证明材料。普通图片和 PDF 直接附在邮件中；超过邮件体积预算的材料提供需登录后台的原件链接。</p>
      {status&&!status.enabled&&<p className="inline-note">本班已关闭自动邮件通知。测试邮件仍可单独发送，不会改变通知开关。</p>}
      <div className="mail-test-box"><strong>发送一封完整的测试邮件</strong><p>发给上方已保存的管理员邮箱，使用虚构学生、测试原因和 PNG 图片，不会新增真实请假记录。请同时检查收件箱和垃圾邮件。</p><Button variant="primary" busy={busy} disabled={!configured||!!message} onClick={test}><Send size={16}/>发送测试邮件（含图片）</Button>{message&&<p role="status" className="inline-note">{message}</p>}{status?.lastTest?.provider_id&&<p className="field-hint">最近测试已被邮件服务商接收。服务商编号：{String(status.lastTest.provider_id)}；实际是否收到请以管理员邮箱为准。</p>}</div>
      <div className="mail-test-box">
        <strong>自动重试与定时检查</strong>
        <p>发送失败后，按本班设置的间隔和次数重试。定时检查用于补捞错过唤醒、已到发送时间的通知，不会重复发送已接收的邮件。</p>
        <div className="mail-retry-actions"><Button busy={retryBusy} disabled={!status?.schedulerConfigured} onClick={()=>retryAction('setup')}>{status?.recovery?'更新定时检查':'建立定时检查'}</Button><Button variant="primary" busy={retryBusy} disabled={!configured||!status?.schedulerConfigured||retryStarted} onClick={()=>retryAction('test')}>测试自动重试（含图片）</Button></div>
        <p className="field-hint">测试首次回调会模拟临时失败，约 10 秒后由调度服务自动重试并发送虚构邮件；不修改真实申请或班级规则。</p>
        {retryMessage&&<p role="status" className="inline-note">{retryMessage}</p>}
        {status?.lastSweep&&<p className="field-hint">上次自动检查：{new Date(status.lastSweep.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>}
        {status?.lastRetryTest&&<p className="inline-note" role="status">最近重试测试：{retryLabels[String(retryState)]||String(retryState)}；已执行 {status.lastRetryTest.attempts} 次回调。{status.lastRetryTest.error&&<span> {status.lastRetryTest.error}</span>}</p>}
      </div>
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div>
  </section>;
}

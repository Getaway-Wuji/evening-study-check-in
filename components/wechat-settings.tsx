'use client';
import {useEffect,useState} from 'react';
import {MessageCircle,RefreshCw,Copy} from 'lucide-react';
import {api,Button,Badge} from './common';
import type {wechatSetup} from '@/lib/wechat-config';
type Status=ReturnType<typeof wechatSetup>;
export default function WechatSettings(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{ok:boolean;message:string}|null>(null),[copied,setCopied]=useState(false);
  useEffect(()=>{let active=true;api('/api/wechat/status').then(value=>{if(active)setStatus(value);}).catch(error=>{if(active)setError(error instanceof Error?error.message:'暂时无法读取微信配置');});return()=>{active=false;};},[]);
  async function check(){setBusy(true);setError('');try{const value=await api('/api/wechat/status',{});setStatus(value);setResult(value);}catch(error){setError(error instanceof Error?error.message:'连接检测失败');}finally{setBusy(false);}}
  async function copy(){try{await navigator.clipboard.writeText(status?.menuURL||'');setCopied(true);}catch{setError('复制失败，请长按菜单地址复制。');}}
  const hostname=status?.origin?new URL(status.origin).hostname:'';
  return <section className="card wechat-setup-card" id="wechat-setup"><div className="card-heading"><h2><MessageCircle size={20}/>公众号接入</h2><Button type="button" busy={busy} onClick={check}><RefreshCw size={16}/>检测微信连接</Button></div>
    <div className="wechat-setup-body">
      <p>学生从公众号菜单进入网页。微信身份首次使用需核对班级名单；没有网页授权权限时，仍可使用学号和密码登录。</p>
      <div className="wechat-setup-status"><div><strong>微信身份登录</strong><Badge tone={status?.oauthConfigured?'blue':'neutral'}>{status?.oauthConfigured?'配置已填，待验证':'尚未接通'}</Badge></div><div><strong>微信网页定位</strong><Badge tone={status?.locationConfigured?'blue':'neutral'}>{status?.locationConfigured?'配置已填，待验证':'使用系统定位'}</Badge></div><div><strong>公众号服务器凭据</strong><span>{status?.appIdConfigured&&status.secretConfigured?'已填写':status?'尚未填写完整':'正在读取…'}</span></div></div>
      {status?.menuURL&&<label className="wechat-menu-link">公众号菜单跳转地址<div><input aria-label="公众号菜单跳转地址" value={status.menuURL} readOnly onFocus={e=>e.target.select()}/><Button type="button" onClick={copy}><Copy size={16}/>{copied?'已复制':'复制'}</Button></div></label>}
      <ol className="wechat-setup-steps"><li>先确认公众号拥有“网页授权”和“获取地理位置接口”权限。开启地理位置上报不能代替网页定位权限。</li><li>在公众平台分别配置网页授权域名、JS 接口安全域名，完成域名校验。{hostname&&<>本站域名：<strong>{hostname}</strong>。</>}</li><li>公众号菜单选择“跳转网页”，填入上方链接；配置完成后，在实际手机微信里测试登录、身份绑定和定位打卡。</li></ol>
      {result&&<div className={result.ok?'inline-note':'form-error'} role="status">{result.message}</div>}{error&&<p className="form-error" role="alert">{error}</p>}
      <p className="field-hint">密钥只在服务器保存。这里的连接检测验证服务器取票据能力，不能代替微信端网页授权、域名和定位实测。</p>
    </div>
  </section>;
}

'use client';
import { useState,useEffect,type FormEvent } from 'react';
import { BookOpen,ArrowRight,ShieldCheck,Users,Clock3,MessageCircle,GraduationCap } from 'lucide-react';
import { Button,api } from './common';
import StudyScene from './study-scene';
export default function Login({demo,wechat,bind=false,wechatEnabled=true}:{demo:boolean;wechat:boolean;bind?:boolean;wechatEnabled?:boolean}){
  const [mode,setMode]=useState(bind?'bind':'login');
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  const [bindExisting,setBindExisting]=useState(false),[adminMode,setAdminMode]=useState(false);
  useEffect(()=>{const notice=new URLSearchParams(location.search).get('notice');if(notice){const messages:Record<string,string>={'wechat-unavailable':'本公众号暂未接通微信身份登录，请使用学号和密码登录。','wechat-in-app':'请从手机微信中的公众号菜单打开，以使用微信身份登录。','wechat-expired':'微信身份确认已过期，请从公众号菜单重新进入。','wechat-permission':'公众号尚未取得网页授权权限，请使用学号和密码，并联系管理员。'};setError(messages[notice]||'微信授权未完成，请重新从公众号菜单进入或使用学号和密码登录。');}},[]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(mode);setError('');const form=Object.fromEntries(new FormData(e.currentTarget));
    try{const r=await api(`/api/auth/${mode}`,form);location.href=r.next;}catch(e){setError(e instanceof Error?e.message:'操作失败');setBusy('');}
  }
  async function preview(role:string){setBusy(role);setError('');try{const r=await api('/api/auth/demo',{role});location.href=r.next;}catch(e){setError(e instanceof Error?e.message:'加载失败');setBusy('');}}
  const choose=(next:string)=>{setMode(next);setAdminMode(false);setError('');};
  return <main className="login-page">
    <section className="login-story">
      <div className="brand"><span className="brand-mark"><BookOpen size={25}/></span><strong>晚习<span>EVENING STUDY</span></strong></div>
      <div className="story-copy"><span className="eyebrow light">一个班级 · 每一份专注</span><h1>把每一个晚上，<br/>留给更好的自己。</h1><p>从准时到场开始，让专注有迹可循。<br/>班级晚自习打卡与请假，在这里轻松完成。</p><div className="story-features"><span><Clock3 size={18}/>按时打卡</span><span><ShieldCheck size={18}/>名单核对</span><span><Users size={18}/>班级同行</span></div></div>
      <StudyScene/><span className="story-footer">每一份专注，都值得认真记录。</span>
    </section>
    <section className="login-form-side"><div className="login-card">
      <span className="eyebrow">欢迎来到晚习</span>
      <h2>{mode==='bind'?'确认你的学生身份':mode==='register'?'注册晚习':adminMode?'管理员登录':'很高兴，在这里见到你'}</h2>
      <p className="muted">{mode==='bind'?'微信授权已完成，请填写名单中的学号和姓名。':mode==='register'?'学号、姓名与管理员录入的名单一致，即可注册。':adminMode?'使用管理员账号进入班级后台。':'登录后查看今天的晚自习安排。'}</p>
      {mode!=='bind'&&<div className="segmented"><button aria-pressed={mode==='login'} className={mode==='login'?'active':''} onClick={()=>choose('login')}>登录</button><button aria-pressed={mode==='register'} className={mode==='register'?'active':''} onClick={()=>choose('register')}>注册</button></div>}
      {mode==='bind'&&<div className="segmented"><button className={!bindExisting?'active':''} onClick={()=>setBindExisting(false)}>核对班级名单</button><button className={bindExisting?'active':''} onClick={()=>setBindExisting(true)}>关联已注册账号</button></div>}
      <form onSubmit={submit} className="form-stack">
        <label>{adminMode&&mode==='login'?'管理员账号':'学号'}<input name="code" autoComplete="username" inputMode={adminMode?'text':'numeric'} placeholder={adminMode&&mode==='login'?'请输入管理员账号':'请输入你的学号'} required maxLength={40}/></label>
        {mode!=='login'&&<label>姓名<input name="name" autoComplete="name" placeholder="请输入班级名单中的真实姓名" required maxLength={30}/></label>}
        {(mode!=='bind'||bindExisting)&&<label>{mode==='register'?'设置密码':'密码'}<input type="password" name="password" autoComplete={mode==='register'?'new-password':'current-password'} placeholder={mode==='register'?'至少 10 位，请勿与他人共享':'请输入密码'} required minLength={mode==='register'?10:1} maxLength={128}/></label>}
        {error&&<div className="form-error" role="alert">{error}</div>}
        <Button variant="primary full" busy={!!busy} type="submit">{mode==='bind'?'确认身份':mode==='register'?'注册':'登录'}<ArrowRight size={17}/></Button>
      </form>
      {mode==='register'&&<p className="registration-note"><ShieldCheck size={14}/>仅核对现有班级名单，不新增学生名额。</p>}
      {mode==='login'&&!adminMode&&wechatEnabled&&<><div className="divider"><span>或使用微信身份</span></div><a className={`button full wechat-button ${wechat?'':'soft'}`} href="/api/auth/wechat/start"><MessageCircle size={19}/>微信公众号登录</a>{!wechat&&<p className="tiny muted center">公众号接入完成后，可在微信内登录</p>}</>}
      <p className="login-help">{mode==='register'||mode==='bind'?'姓名或学号与名单不符？请联系管理员更正。':'忘记密码或账号被误注册？请联系管理员核实处理。'}</p>
      {mode!=='bind'&&<button className="admin-entry" onClick={()=>{setMode('login');setAdminMode(!adminMode);setError('');}}>{adminMode?'返回学生登录':'管理员登录'}</button>}
      {demo&&<div className="demo-entry"><strong className="demo-label">本地演示模式</strong><p>使用虚构班级体验完整流程，模拟时间为 17:45。</p><div><Button busy={!!busy} onClick={()=>preview('student')}><GraduationCap size={17}/>学生端体验</Button><Button busy={!!busy} onClick={()=>preview('admin')}><Users size={17}/>管理后台体验</Button></div></div>}
      <p className="login-privacy"><ShieldCheck size={14}/>身份仅用于本班考勤，证明材料按权限查看</p>
    </div><span className="login-bottom">晚习 · 班级晚自习管理</span></section>
  </main>;
}

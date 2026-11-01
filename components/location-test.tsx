'use client';
import {useEffect,useRef,useState} from 'react';
import {LocateFixed,MapPin,FlaskConical,ShieldCheck} from 'lucide-react';
import {useStore} from './store';
import {useLocationRequest} from './use-location-request';
import LocationHelp from './location-help';
import type {LocationStrategy} from '@/lib/location';
import {Button,Badge,api} from './common';
import type {LocationTestContext,LocationTestResult} from '@/lib/location-test';
import styles from './location-test.module.css';

async function readContext():Promise<LocationTestContext>{
  const response=await fetch('/api/location-test',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'暂时无法读取测试安排');return data;
}
export default function StudentLocationTest(){
  const {d}=useStore(),[context,setContext]=useState<LocationTestContext|null>(null),[selected,setSelected]=useState(''),[result,setResult]=useState<LocationTestResult|null>(null),[checking,setChecking]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),{locate,busy,error:locationError,setError:setLocationError,progress,cancel,report}=useLocationRequest(d.wechat.location);
  const target=context?.targets.find(t=>t.id===selected),rulesKey=target?JSON.stringify(target.rules):'',available=!!context?.available;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;
    void readContext().then(value=>{if(active){setContext(value);setSelected(previous=>previous||value.targets[0]?.id||'');setError('');}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'测试安排加载失败');});
    return()=>{active=false;};
  },[d.now]);
  useEffect(()=>{setResult(null);setLocationError('');},[selected,rulesKey,setLocationError]);
  const cancelRef=useRef(cancel);cancelRef.current=cancel;
  useEffect(()=>{if(!available){cancelRef.current();setResult(null);}},[available]);
  async function test(strategy?:LocationStrategy){
    if(checking||busy)return;setChecking(true);setError('');setResult(null);setLocationError('');
    try{
      const latest=await readContext();if(!mounted.current)return;setContext(latest);
      if(!latest.available)return;
      const current=latest.targets.find(t=>t.id===selected);if(!current)throw new Error('测试教室已更新，请重新选择');
      const location=await locate(current.rules,strategy);if(!location||!mounted.current)return;
      const tested:LocationTestResult=await api('/api/location-test',{sessionId:current.id,...location.position});
      if(mounted.current)setResult(tested);
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'定位测试失败，请重试');}
    finally{if(mounted.current)setChecking(false);}
  }
  return <section className={`card ${styles.panel}`} aria-label="临时定位测试"><div className={styles.heading}><div><span className={styles.caption}><FlaskConical size={16}/>管理员临时开放</span><h2>先测一测，你的定位是否达标</h2><p>非打卡时段也能检查定位。这里只测试，不会记录签到。</p></div><Badge tone="blue">定位测试</Badge></div>
    {!context&&!error&&<p role="status">正在读取可测试的教室…</p>}
    {context&&!available&&<p className="inline-note" role="status">{context.reason}</p>}
    {!!context?.targets.length&&<><label className={styles.field}>测试教室<select value={selected} disabled={checking||busy||!available} onChange={e=>setSelected(e.target.value)}>{selected&&!target&&<option value={selected} disabled>原教室安排已更新，请重新选择</option>}{context.targets.map(t=><option value={t.id} key={t.id}>{t.rules.locationName} · {t.rules.radius} 米范围 · {t.date}</option>)}</select></label>{target&&<p className="field-hint">按 {target.date} 已发布的教室规则测试：允许范围 {target.rules.radius} 米，精度要求 {target.rules.accuracyLimit} 米以内，位置有效期 {target.rules.locationMaxAge} 秒。</p>}</>}
    <div className={styles.controls}><Button type="button" variant="primary" busy={checking||busy} disabled={!available||!target} onClick={()=>void test()}><LocateFixed size={18}/>{result?'重新测试定位':'开始测试定位'}</Button>{busy&&<Button type="button" onClick={cancel}>取消定位</Button>}</div>
    {progress&&<p className={styles.progress} role="status">{progress}</p>}{(error||locationError)&&<p className="form-error" role="alert">{error||locationError}</p>}
    <LocationHelp error={locationError||error||(!result?.eligible?result?.message:'')||''} busy={checking||busy} report={report} disabled={!available||!target} onRetry={()=>void test('compatible')}/>
    {result&&<div className={`${styles.result} ${result.eligible?styles.good:styles.bad}`} role="status"><strong><MapPin size={19}/>{result.eligible?'本次定位测试达标 · 未签到':'本次定位测试未达标'}</strong><p>{result.message}</p><div className={styles.metrics}><span>距离教室圆心<b>{result.distance} 米</b></span><span>设备报告精度<b>{Math.round(result.accuracy)} 米</b></span><span>允许范围<b>{result.target.rules.radius} 米</b></span></div><small>{result.target.rules.locationName} · 测试于 {new Date(result.testedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small></div>}
    <p className={styles.note}><ShieldCheck size={16}/>测试结果仅供本次检查，不保存定位坐标，不计入考勤。正式打卡时仍需重新定位，并满足当场的时间及其他要求。</p>
  </section>;
}

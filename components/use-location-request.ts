'use client';
import {useEffect,useRef,useState} from 'react';
import {acquireLocation} from '@/lib/wechat-browser';
import type {Rules} from '@/lib/domain';
import type {LocationProgress,LocationStrategy,LocationDiagnostic} from '@/lib/location';
import {preferredLocationStrategy,locationReport} from '@/lib/location-device';
export function useLocationRequest(wechatConfigured:boolean){
  const active=useRef<AbortController|null>(null),mounted=useRef(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[elapsed,setElapsed]=useState(0),[progress,setProgress]=useState<LocationProgress|null>(null);
  const [strategy,setStrategy]=useState<LocationStrategy>('standard'),[report,setReport]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();};},[]);
  async function locate(rules:Pick<Rules,'accuracyLimit'|'locationMaxAge'>,override?:LocationStrategy){
    active.current?.abort();const controller=new AbortController();active.current=controller;
    const selected=override??preferredLocationStrategy(navigator.userAgent),events:LocationDiagnostic[]=[];let status='no-result',permission='unknown';
    setStrategy(selected);setReport('');setBusy(true);setError('');setElapsed(0);setProgress({stage:'locating'});const start=Date.now();
    try{void navigator.permissions?.query({name:'geolocation'}).then(p=>{permission=p.state;}).catch(()=>{});}catch{/* Permission querying is optional in embedded browsers. */}
    const timer=setInterval(()=>{if(mounted.current&&active.current===controller)setElapsed(Math.floor((Date.now()-start)/1000));},1000);
    try{const result=await acquireLocation(wechatConfigured,{...(override?{strategy:override}:{}),signal:controller.signal,targetAccuracy:rules.accuracyLimit,maxAgeSeconds:rules.locationMaxAge,timeoutMs:45000,onDiagnostic:event=>{events.push(event);if(events.length>24)events.shift();},onProgress:p=>{if(mounted.current&&active.current===controller)setProgress(p);}});status='received';if(mounted.current&&active.current===controller)return result;}
    catch(error){status=error&&typeof error==='object'&&'kind' in error?String(error.kind):'technical';if(mounted.current&&active.current===controller)setError(error instanceof Error?error.message:'定位失败，请检查手机权限后重试');}
    finally{clearInterval(timer);if(mounted.current&&active.current===controller){setReport(locationReport({userAgent:navigator.userAgent,strategy:selected,elapsedMs:Date.now()-start,status,permission,events}));setBusy(false);active.current=null;}}
  }
  const message=progress?.stage==='improving'?`当前精度约 ${Math.round(progress.accuracy!)} 米，正在继续优化…`:progress?.stage==='compatible'?`兼容定位：正在向系统请求位置（第 ${progress.attempt||1}/3 次）…`:progress?.stage==='network'?'正在切换系统定位策略；是否使用 Wi-Fi 或卫星由手机决定…':progress?.stage==='wechat'?'正在等待微信返回当前位置…':'正在收集当前位置，请保持页面在前台…';
  return {locate,cancel:()=>active.current?.abort(),busy,error,setError,progress:busy?`${message} 已等待 ${elapsed} 秒`:'',elapsed,strategy,report};
}

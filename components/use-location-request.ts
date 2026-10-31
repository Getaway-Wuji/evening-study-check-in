'use client';
import {useEffect,useRef,useState} from 'react';
import {acquireLocation} from '@/lib/wechat-browser';
import type {Rules} from '@/lib/domain';
import type {LocationProgress} from '@/lib/location';
export function useLocationRequest(wechatConfigured:boolean){
  const active=useRef<AbortController|null>(null),mounted=useRef(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[elapsed,setElapsed]=useState(0),[progress,setProgress]=useState<LocationProgress|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();};},[]);
  async function locate(rules:Pick<Rules,'accuracyLimit'|'locationMaxAge'>){
    active.current?.abort();const controller=new AbortController();active.current=controller;
    setBusy(true);setError('');setElapsed(0);setProgress({stage:'locating'});const start=Date.now();
    const timer=setInterval(()=>{if(mounted.current&&active.current===controller)setElapsed(Math.floor((Date.now()-start)/1000));},1000);
    try{const result=await acquireLocation(wechatConfigured,{signal:controller.signal,targetAccuracy:rules.accuracyLimit,maxAgeSeconds:rules.locationMaxAge,timeoutMs:45000,onProgress:p=>{if(mounted.current&&active.current===controller)setProgress(p);}});if(mounted.current&&active.current===controller)return result;}
    catch(error){if(mounted.current&&active.current===controller)setError(error instanceof Error?error.message:'定位失败，请检查手机权限后重试');}
    finally{clearInterval(timer);if(mounted.current&&active.current===controller){setBusy(false);active.current=null;}}
  }
  const message=progress?.stage==='improving'?`当前精度约 ${Math.round(progress.accuracy!)} 米，正在继续优化…`:progress?.stage==='network'?'信号较弱，正在尝试 Wi-Fi / 网络辅助定位…':progress?.stage==='wechat'?'正在等待微信返回当前位置…':'正在收集当前位置，请保持页面在前台…';
  return {locate,cancel:()=>active.current?.abort(),busy,error,setError,progress:busy?`${message} 已等待 ${elapsed} 秒`:'',elapsed};
}

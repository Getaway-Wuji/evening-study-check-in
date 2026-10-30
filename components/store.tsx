'use client';
import { createContext,useContext,useState,useEffect,useCallback,type ReactNode } from 'react';
import { api } from './common';
import type { bootstrap } from '@/lib/service';
export type Data=Awaited<ReturnType<typeof bootstrap>>;
type Store={d:Data;refresh:()=>Promise<void>;act:(action:string,data:unknown)=>Promise<any>;busy:boolean;notify:(message:string,error?:boolean)=>void};
const Context=createContext<Store|null>(null);
export function useStore(){const value=useContext(Context);if(!value)throw new Error('页面尚未准备完成');return value;}
export function Provider({children}:{children:ReactNode}){
  const [d,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[toast,setToast]=useState<{text:string;error:boolean}|null>(null);
  const notify=useCallback((text:string,error=false)=>setToast({text,error}),[]);
  const refresh=useCallback(async()=>{try{const data=await api('/api/data');setData(data);setError('');}catch(e){setError(e instanceof Error?e.message:'无法加载');}},[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},30000);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5500);return()=>clearTimeout(timer);},[toast]);
  const act=async(action:string,data:unknown)=>{setBusy(true);try{const result=await api('/api/actions',{action,data});notify(result.message||'已保存');await refresh();return result;}catch(e){notify(e instanceof Error?e.message:'操作未完成',true);return null;}finally{setBusy(false);}};
  if(!d)return <main className="loading-page"><div className="loading-logo">晚</div><h2>{error||'正在准备今天的晚习…'}</h2>{error?<div className="button-row"><button className="button" onClick={()=>void refresh()}>重新加载</button><a href="/login" className="button primary">返回登录</a></div>:<div className="loading-line"/>}</main>;
  return <Context.Provider value={{d,refresh,act,busy,notify}}>{error&&<div className="connection-error" role="alert">连接暂时中断，当前为上次加载的数据。<button onClick={()=>void refresh()}>重新加载</button></div>}{children}{toast&&<div className={`toast ${toast.error?'error':''}`} role="status">{toast.text}<button aria-label="关闭提示" onClick={()=>setToast(null)}>×</button></div>}</Context.Provider>;
}

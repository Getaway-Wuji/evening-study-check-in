'use client';
import { useEffect,useRef,useState,type ReactNode,type FormEvent } from 'react';
import { X,LoaderCircle,UploadCloud,FileText,Check,Trash2 } from 'lucide-react';
import { upload } from '@vercel/blob/client';
import {defaultClassPolicy,uploadLimits} from '@/lib/class-policy';
export async function api(url:string,body?:unknown){
  const res=await fetch(url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});
  const value=await res.json();if(!res.ok)throw new Error(value.error||'暂时无法完成操作');return value;
}
export function Button({children,busy=false,variant='',...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{busy?:boolean;variant?:string}){return <button {...props} disabled={props.disabled||busy} className={`button ${variant} ${props.className||''}`}>{busy?<LoaderCircle size={17} className="spin"/>:null}{children}</button>;}
export function Badge({children,tone=''}:{children:ReactNode;tone?:string}){return <span className={`badge ${tone}`}>{children}</span>;}
export function Empty({title='暂时没有记录',text='有新的记录后会显示在这里。'}:{title?:string;text?:string}){return <div className="empty"><FileText size={30}/><h3>{title}</h3><p>{text}</p></div>;}
export function Dialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement,old=document.body.style.overflow;document.body.style.overflow='hidden';
    const el=ref.current;el?.querySelector<HTMLElement>('button,input,select,textarea')?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')closeRef.current();if(e.key==='Tab'){
      const a=Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')||[]);const first=a[0],last=a[a.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=old;previous?.focus();};
  },[]);
  return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`dialog ${wide?'wide':''}`}><div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></div><div className="dialog-body">{children}</div></div></div>;
}
export interface Uploaded {id:string;name:string}
export function UploadField({purpose,value,onChange,cameraOnly=false,limits=uploadLimits(defaultClassPolicy,purpose),onUploadingChange}:{purpose:'photo'|'proof';value:Uploaded[];onChange:(value:Uploaded[])=>void;cameraOnly?:boolean;limits?:ReturnType<typeof uploadLimits>;onUploadingChange?:(busy:boolean)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function add(list:FileList|null){
    if(!list)return;setError('');setBusy(true);onUploadingChange?.(true);let next=[...value];
    try{if(list.length+next.length>limits.maxFiles)throw new Error(`最多上传 ${limits.maxFiles} 个文件`);
      for(const file of Array.from(list)){
        if(file.size>limits.maxMB*1024*1024)throw new Error(`每个文件不超过 ${limits.maxMB} MB`);
        if(!limits.allowedTypes.includes(file.type))throw new Error('请选择本班允许的文件格式');
        const init=await api('/api/files',{name:file.name,size:file.size,contentType:file.type,purpose});
        let result;
        if(init.local){const fd=new FormData();fd.append('file',file);fd.append('purpose',purpose);const r=await fetch('/api/files',{method:'POST',body:fd});result=await r.json();if(!r.ok)throw new Error(result.error);}
        else{await upload(init.pathname,file,{access:'private',handleUploadUrl:'/api/files/token',clientPayload:JSON.stringify({id:init.id}),multipart:file.size>4*1024*1024});result=await api(`/api/files/${init.id}`,{});}
        next=[...next,{id:result.id,name:result.name}];onChange(next);
      }
    }catch(e){setError(e instanceof Error?e.message:'上传失败');}finally{setBusy(false);onUploadingChange?.(false);}
  }
  return <div className="upload-field"><label className={`upload-zone ${busy?'uploading':''}`}>
    {busy?<LoaderCircle className="spin" size={25}/>:<UploadCloud size={25}/>}<strong>{busy?'正在安全上传…':purpose==='photo'?(cameraOnly?'拍摄打卡照片':'拍摄或上传照片'):'点击上传证明材料'}</strong><span>{limits.allowedTypes.includes('application/pdf')?'JPG、PNG、PDF':'JPG、PNG'} · 最多 {limits.maxFiles} 个 · 每个 {limits.maxMB} MB 以内</span>
    <input aria-label={purpose==='photo'?'上传打卡照片':'上传请假证明'} type="file" accept={limits.allowedTypes.join(',')} capture={purpose==='photo'&&cameraOnly?'environment':undefined} multiple={!cameraOnly} disabled={busy||value.length>=limits.maxFiles} onChange={e=>{void add(e.target.files);e.target.value='';}}/>
  </label>{error&&<p className="form-error" role="alert">{error}</p>}{value.map(f=><div className="uploaded" key={f.id}><FileText size={17}/><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a><Check size={16}/><button type="button" className="icon-button" aria-label={`移除 ${f.name}`} onClick={()=>onChange(value.filter(x=>x.id!==f.id))}><Trash2 size={15}/></button></div>)}</div>;
}

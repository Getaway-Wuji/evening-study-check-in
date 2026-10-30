'use client';
import { useState,type ReactNode } from 'react';
import { Clock3,MapPin,FileText,LocateFixed,ArrowUpRight } from 'lucide-react';
import { Button } from './common';
import {useStore} from './store';
import {needsLeaveProof} from '@/lib/class-policy';
import { wgsToGcj,type Rules } from '@/lib/domain';
export default function RulesEditor({initial,onSave,busy,label,children,inheritTime=false,defaultTime}:{initial:Rules;onSave:(rules:Rules,form:FormData)=>void;busy:boolean;label:string;children?:ReactNode;inheritTime?:boolean;defaultTime?:Pick<Rules,'open'|'close'|'studyStart'>}){
  const {d}=useStore(),types=d.settings.policy.leaveTypes.filter(t=>t.enabled);
  const [r,setR]=useState<Rules>(structuredClone(initial)),[locating,setLocating]=useState(false),[locationError,setLocationError]=useState('');
  const display=inheritTime&&defaultTime?{...r,open:defaultTime.open,close:defaultTime.close,studyStart:defaultTime.studyStart}:r;
  const photo=!!(r.photoEnabled??r.photoRequired),note=!!(r.noteEnabled??r.noteRequired);
  const update=(key:keyof Rules,value:unknown)=>setR(v=>({...v,[key]:value,...(['locationName','latitude','longitude'].includes(key)?{locationConfirmed:false}:{}),...(key==='photoEnabled'&&!value?{photoRequired:false}:{}),...(key==='noteEnabled'&&!value?{noteRequired:false}:{})}));
  function capturePoint(){
    setLocationError('');if(!navigator.geolocation){setLocationError('当前浏览器不支持定位，请通过地图取点填写坐标');return;}
    setLocating(true);navigator.geolocation.getCurrentPosition(p=>{const [latitude,longitude]=wgsToGcj(p.coords.latitude,p.coords.longitude);setR(v=>({...v,latitude:+latitude.toFixed(6),longitude:+longitude.toFixed(6),locationConfirmed:false}));setLocating(false);if(p.coords.accuracy>100)setLocationError('当前位置精度较低，保存前请在地图上核对点位。');},()=>{setLocating(false);setLocationError('无法获取位置，请检查权限或通过地图取点填写。');},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  }
  return <form className="form-stack" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave({...display,open:String(f.get('open')||display.open),close:String(f.get('close')||display.close),studyStart:String(f.get('studyStart')||display.studyStart),photoEnabled:photo,noteEnabled:note,proofRequired:{...r.proofRequired,...Object.fromEntries(types.map(type=>[type.id,needsLeaveProof(r,type)]))}},f);}}>
    {children}<div className="form-section-title"><Clock3 size={17}/>打卡时间{inheritTime&&<span className="optional">沿用默认时间</span>}</div>
    <div className="form-grid three">{([['open','开始打卡'],['studyStart','晚自习开始'],['close','打卡截止']] as const).map(([key,text])=><label key={key}>{text}<input name={key} required type="time" disabled={inheritTime} value={display[key]} onInput={e=>update(key,e.currentTarget.value)} onChange={e=>update(key,e.target.value)}/></label>)}</div>
    <p className="field-hint">时间按北京时间设置，可自行填写。截止时间包含对应分钟，下一分钟起不能提交。</p>
    <div className="form-section-title"><MapPin size={17}/>教室与定位范围</div>
    <label>教室或地点名称<input required maxLength={80} value={r.locationName} onChange={e=>update('locationName',e.target.value)} placeholder="例如：教学楼与教室编号"/></label>
    <div className="button-row point-actions"><Button type="button" busy={locating} onClick={capturePoint}><LocateFixed size={16}/>把当前位置设为打卡点</Button><a href="https://lbs.qq.com/getPoint/" target="_blank" rel="noreferrer" className="button">地图取点<ArrowUpRight size={14}/></a></div>
    <p className="field-hint">可在教室现场获取位置，或在地图取点后填写坐标。坐标统一采用 GCJ-02。</p>
    <div className="form-grid three"><label>纬度 GCJ-02<input type="number" required step="any" min={-90} max={90} value={r.latitude} onChange={e=>update('latitude',+e.target.value)}/></label><label>经度 GCJ-02<input type="number" required step="any" min={-180} max={180} value={r.longitude} onChange={e=>update('longitude',+e.target.value)}/></label><label>允许半径 米<input type="number" required min={10} max={2000} value={r.radius} onChange={e=>update('radius',+e.target.value)}/></label></div>
    {locationError&&<p className="form-error" role="alert">{locationError}</p>}
    <label className="check-label"><input type="checkbox" checked={r.locationRequired} onChange={e=>update('locationRequired',e.target.checked)}/>要求定位并校验打卡范围</label>
    {r.locationRequired&&<><label className="check-label"><input type="checkbox" checked={!!r.locationConfirmed} onChange={e=>update('locationConfirmed',e.target.checked)}/>我已核对这个教室的实际定位点</label><div className="form-grid"><label>定位精度上限 米<input type="number" min={5} max={200} value={r.accuracyLimit} onChange={e=>update('accuracyLimit',+e.target.value)}/></label><label>位置有效期 秒<input type="number" min={15} max={120} value={r.locationMaxAge} onChange={e=>update('locationMaxAge',+e.target.value)}/></label></div></>}
    <div className="form-section-title"><FileText size={17}/>本场打卡内容</div>
    <div className="base-fields"><span>姓名 <strong>自动识别</strong></span><span>定位 <strong>{r.locationRequired?'必填并校验范围':'未启用'}</strong></span></div>
    <label className="check-label"><input type="checkbox" checked={photo} onChange={e=>update('photoEnabled',e.target.checked)}/>额外收集打卡照片</label>
    {photo&&<div className="nested-fields"><label className="check-label"><input type="checkbox" checked={r.photoRequired} onChange={e=>update('photoRequired',e.target.checked)}/>照片必填</label><label className="check-label"><input type="checkbox" checked={r.cameraOnly} onChange={e=>update('cameraOnly',e.target.checked)}/>拍照入口优先打开相机</label></div>}
    <label className="check-label"><input type="checkbox" checked={note} onChange={e=>update('noteEnabled',e.target.checked)}/>额外收集打卡备注</label>
    {note&&<label className="check-label nested-fields"><input type="checkbox" checked={r.noteRequired} onChange={e=>update('noteRequired',e.target.checked)}/>备注必填</label>}
    <p className="field-hint">通常保留姓名和定位即可；未启用的照片、备注不会出现在学生打卡表单中。</p>
    <div className="form-section-title">请假证明要求</div><div className="weekday-options">{types.map(type=><label className="check-label" key={type.id}><input type="checkbox" checked={needsLeaveProof(r,type)} onChange={e=>setR(v=>({...v,proofRequired:{...v.proofRequired,[type.id]:e.target.checked}}))}/>{type.name}需证明</label>)}</div>
    <Button variant="primary full" busy={busy} type="submit">{label}</Button>
  </form>;
}

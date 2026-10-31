'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Map,RotateCcw,MapPin,WifiOff} from 'lucide-react';
import type * as Leaflet from 'leaflet';
import {Button,Badge} from './common';
import {assessFence,fenceDistance,fencePoint,fenceRing,gcjToWgs,localMeters,validFence,type FencePoint} from '@/lib/geofence';
import {wgsToGcj,type Rules} from '@/lib/domain';
import type {StudyLocation} from '@/lib/location';
const tileURL=process.env.NEXT_PUBLIC_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution=process.env.NEXT_PUBLIC_MAP_ATTRIBUTION||'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
type MapState={map:Leaflet.Map;range:Leaflet.Polygon;center:Leaflet.CircleMarker;sample?:Leaflet.CircleMarker;error?:Leaflet.Circle;L:typeof Leaflet;fenceKey:string};
export default function GeofencePreview({rules,sample,onMoveCenter}:{rules:Rules;sample?:StudyLocation|null;onMoveCenter?:(point:FencePoint)=>void}){
  const valid=validFence(rules),uid=useId().replace(/:/g,''),host=useRef<HTMLDivElement>(null),mapRef=useRef<MapState|null>(null),current=useRef(rules);
  current.current=rules;
  const [mode,setMode]=useState<'schematic'|'map'>('schematic'),[warning,setWarning]=useState(''),[loading,setLoading]=useState(false),[ready,setReady]=useState(0),[trial,setTrial]=useState<FencePoint|null>(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{setTrial(null);},[rules.latitude,rules.longitude]);
  useEffect(()=>{if(!sample)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[sample]);
  useEffect(()=>{
    if(mode!=='map'||!valid||!host.current)return;let active=true,instance:Leaflet.Map|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    setLoading(true);setWarning('');
    const failed=()=>{if(!active)return;setWarning('地图底图暂时无法加载，已切回范围示意；定位和距离验算仍可使用。');setLoading(false);setMode('schematic');};
    (async()=>{
      try{
        const loaded=await import('leaflet'),L=loaded.default||loaded;if(!active||!host.current)return;
        const r=current.current,map=L.map(host.current,{scrollWheelZoom:false,zoomControl:true,attributionControl:true}).setView(gcjToWgs(r.latitude,r.longitude),18);instance=map;
        const layer=L.tileLayer(tileURL,{attribution,maxZoom:19,keepBuffer:0,updateWhenIdle:true,updateWhenZooming:false,referrerPolicy:'strict-origin-when-cross-origin'});
        let successes=0;timer=setTimeout(()=>{if(!successes)failed();else if(active)setLoading(false);},12000);
        layer.on('tileload',()=>{successes++;if(active){setLoading(false);clearTimeout(timer);}});layer.addTo(map);
        const range=L.polygon(fenceRing(r).map(([a,b])=>gcjToWgs(a,b)),{color:'#477fbd',weight:3,fillColor:'#7baee0',fillOpacity:0.2}).addTo(map);
        const center=L.circleMarker(gcjToWgs(r.latitude,r.longitude),{radius:6,color:'#fff',weight:2,fillColor:'#2c629b',fillOpacity:1}).addTo(map);
        map.on('click',event=>{const [latitude,longitude]=wgsToGcj(event.latlng.lat,event.latlng.lng);setTrial({latitude,longitude});});
        map.fitBounds(range.getBounds().pad(0.3),{maxZoom:19});mapRef.current={map,range,center,L,fenceKey:`${r.latitude}/${r.longitude}/${r.radius}`};setReady(n=>n+1);
      }catch{failed();}
    })();
    return()=>{active=false;clearTimeout(timer);instance?.remove();mapRef.current=null;};
  },[mode,valid]);
  const assessment=sample&&valid?assessFence(rules,sample,now):null,point=trial||(sample?fencePoint(sample):null),distance=point&&valid?fenceDistance(rules,point):null;
  useEffect(()=>{
    const view=mapRef.current;if(!view||!valid)return;
    const {L,map,range,center}=view;range.setLatLngs(fenceRing(rules).map(([a,b])=>gcjToWgs(a,b)));center.setLatLng(gcjToWgs(rules.latitude,rules.longitude));
    const fenceKey=`${rules.latitude}/${rules.longitude}/${rules.radius}`;if(fenceKey!==view.fenceKey){map.fitBounds(range.getBounds().pad(0.3),{maxZoom:19,animate:false});view.fenceKey=fenceKey;}
    if(view.sample)map.removeLayer(view.sample);if(view.error)map.removeLayer(view.error);
    if(point){const p=gcjToWgs(point.latitude,point.longitude);view.sample=L.circleMarker(p,{radius:7,color:'#fff',weight:2,fillColor:'#ce863b',fillOpacity:1}).addTo(map);if(sample&&!trial)view.error=L.circle(p,{radius:sample.accuracy,color:'#ce863b',weight:1,dashArray:'5 5',fillColor:'#e8b46b',fillOpacity:0.15}).addTo(map);}
  },[ready,valid,rules.latitude,rules.longitude,rules.radius,sample,trial]);
  if(!valid)return <div className="fence-empty"><MapPin size={23}/><strong>填写实际坐标后显示允许范围</strong><p>填写本教室的经纬度和 10–2000 米半径，圆圈会跟随当前表单更新。</p></div>;
  const offset=point?localMeters(rules,point):null,extent=Math.max(rules.radius*1.55,(distance||0)+(sample&&!trial?sample.accuracy:0))*1.1,scale=125/extent;
  return <section className="fence-preview" aria-label="打卡地点与允许范围预览">
    <div className="fence-heading"><div><strong>允许打卡范围</strong><span>圆心：{rules.locationName||'当前教室'} · 半径 {rules.radius} 米</span></div><Badge tone={mode==='map'?'blue':'neutral'}>{mode==='map'?'地图底图':'范围示意'}</Badge></div>
    <div className="fence-stage">
      {mode==='map'?<div className="fence-map" ref={host} aria-label="允许范围地图"/>:<svg viewBox="0 0 400 300" role="img" aria-label={`以当前教室为圆心，允许半径 ${rules.radius} 米的范围示意图，不含道路和建筑底图`}>
        <defs><pattern id={'grid-'+uid} width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#c7d8e9" strokeWidth="0.6"/></pattern></defs>
        <rect width="400" height="300" fill="#edf4fa"/><rect width="400" height="300" fill={`url(#grid-${uid})`}/>
        <path d="M 200 18 V 282 M 18 150 H 382" stroke="#a8bfd7" strokeDasharray="4 5"/>
        <circle cx="200" cy="150" r={rules.radius*scale} fill="#7baee033" stroke="#477fbd" strokeWidth="2.5"/>
        <line x1="200" y1="150" x2={200+rules.radius*scale} y2="150" stroke="#477fbd" strokeDasharray="4 4"/>
        <text x={200+rules.radius*scale/2} y="141" textAnchor="middle" fill="#2c629b" fontSize="12">{rules.radius} m</text>
        {offset&&<><line x1="200" y1="150" x2={200+offset.east*scale} y2={150-offset.north*scale} stroke="#ce863b" strokeDasharray="4 4"/>{sample&&!trial&&<circle cx={200+offset.east*scale} cy={150-offset.north*scale} r={sample.accuracy*scale} fill="#e8b46b22" stroke="#ce863b" strokeDasharray="4 4"/>}<circle cx={200+offset.east*scale} cy={150-offset.north*scale} r="6" fill="#ce863b" stroke="white" strokeWidth="2"/></>}
        <circle cx="200" cy="150" r="6" fill="#2c629b" stroke="white" strokeWidth="2"/><text x="200" y="174" textAnchor="middle" fill="#294c70" fontSize="12">打卡中心</text>
        <text x="374" y="26" textAnchor="middle" fill="#546f89" fontSize="12">北 ↑</text><text x="18" y="286" fill="#546f89" fontSize="10">无底图示意，不能据此辨认楼栋</text>
      </svg>}
      {loading&&<span className="fence-loading" role="status">地图底图加载中，范围圈已绘制…</span>}
    </div>
    <div className="fence-legend"><span><i className="fence-blue"/>蓝圈：允许的地理范围</span><span><i className="fence-orange"/>橙点：{trial?'地图试点':'现场定位'}，虚圈为设备误差</span></div>
    <div className="fence-controls"><Button type="button" onClick={()=>{setWarning('');setMode(mode==='map'?'schematic':'map');}}>{mode==='map'?<WifiOff size={16}/>:<Map size={16}/>} {mode==='map'?'使用范围示意':'打开地图底图'}</Button>{mode==='map'&&<Button type="button" onClick={()=>{const v=mapRef.current;if(v)v.map.fitBounds(v.range.getBounds().pad(0.3),{maxZoom:19});}}><RotateCcw size={15}/>回到打卡范围</Button>}</div>
    {warning&&<p className="inline-note" role="status">{warning}</p>}
    <p className="field-hint">底图使用 OpenStreetMap，坐标已转换后叠加范围；点击地图可试算距离，不会直接修改地点。当前预览以表单为准，保存并发布后生效。</p>
    {point&&distance!==null&&<div className={`fence-result ${trial?distance<=rules.radius?'pass':'fail':assessment?.eligible?'pass':'fail'}`} role="status"><strong>{trial?'地图试点':'现场试测'}距圆心约 {Math.round(distance)} 米 · {distance<=rules.radius?'在范围内':'超出范围'}</strong><p>{trial?'仅试算地理范围，不能代替真实手机定位。':`${assessment?.message}；设备精度约 ${Math.round(sample!.accuracy)} 米。`}</p>{trial&&onMoveCenter&&<Button type="button" onClick={()=>onMoveCenter(trial)}>将此地图试点设为打卡中心</Button>}{trial&&<Button type="button" onClick={()=>setTrial(null)}>清除地图试点</Button>}</div>}
    <p className="field-hint">蓝圈不会提高手机定位精度。实际打卡还要满足精度上限、位置有效期及开放时间；不同楼层无法仅靠二维定位区分。</p>
  </section>;
}

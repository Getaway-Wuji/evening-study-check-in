import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireLocation} from '../lib/wechat-browser';
const originals=new Map(['window','navigator','location','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
let nativeCalls=0,signatureCalls=0,wxCalls=0,mode:'ok'|'cancel'|'cancel-fail'|'deny'|'invalid'|'bad-signature'='ok';
let onReady=()=>{},onError=()=>{};
let href='https://study.example.test/student';
const wx={
  config:()=>{queueMicrotask(()=>mode==='bad-signature'?onError():onReady());},
  ready:(callback:()=>void)=>{onReady=callback;},error:(callback:()=>void)=>{onError=callback;},
  checkJsApi:({success}:any)=>success({checkResult:{getLocation:true}}),
  getLocation:({success,fail,cancel}:any)=>{wxCalls++;if(mode==='cancel')cancel();else if(mode==='cancel-fail')fail({errMsg:'getLocation:cancel'});else if(mode==='deny')fail({errMsg:'getLocation:fail auth deny'});else success({latitude:31.1,longitude:121.2,accuracy:mode==='invalid'?undefined:15});},
};
Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true,wx,__studyEntryURL:href}});
Object.defineProperty(globalThis,'location',{configurable:true,value:{get href(){return href;}}});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Android MicroMessenger',geolocation:{getCurrentPosition:(success:any)=>{nativeCalls++;success({coords:{latitude:31.1,longitude:121.2,accuracy:20}});}}}});
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_input:unknown,init:RequestInit)=>{signatureCalls++;assert.equal(JSON.parse(String(init.body)).url,href.split('#')[0]);return new Response(JSON.stringify({appId:'fixture-app',timestamp:1,nonceStr:'fixture',signature:'fixture'}),{headers:{'Content-Type':'application/json'}});}});

test('微信准备完成后取定位，同一页面复用配置，返回 GCJ-02 和真实精度',async()=>{
  const value=await acquireLocation(true);assert.equal(value.source,'wechat');assert.equal(value.position.coordinateSystem,'gcj02');assert.equal(value.position.accuracy,15);
  assert.equal(nativeCalls,0);assert.equal(signatureCalls,1);assert.equal(wxCalls,1);
  await acquireLocation(true);assert.equal(signatureCalls,1);assert.equal(wxCalls,2);
});
test('主动取消和拒绝权限不再触发第二次系统定位请求',async()=>{
  mode='cancel';await assert.rejects(acquireLocation(true),/已取消/);
  mode='cancel-fail';await assert.rejects(acquireLocation(true),/已取消/);
  mode='deny';await assert.rejects(acquireLocation(true),/权限/);assert.equal(nativeCalls,0);
});
test('微信缺失可靠精度时切换系统定位，保持 WGS-84 坐标系',async()=>{
  mode='invalid';const value=await acquireLocation(true);
  assert.equal(value.source,'system');assert.equal(value.fallback,true);assert.equal(value.position.coordinateSystem,'wgs84');assert.equal(value.position.accuracy,20);assert.equal(nativeCalls,1);
});
test('页面切换后的签名失败可重试，恢复后重新使用微信定位',async()=>{
  mode='bad-signature';href='https://study.example.test/student?test=retry#section';
  assert.equal((await acquireLocation(true)).source,'system');
  const previous=signatureCalls;mode='ok';assert.equal((await acquireLocation(true)).source,'wechat');assert.equal(signatureCalls,previous+1);
});
test('未接通微信定位时直接使用系统定位，不请求微信签名',async()=>{
  const previous=signatureCalls,value=await acquireLocation(false);assert.equal(value.source,'system');assert.equal(value.fallback,false);assert.equal(signatureCalls,previous);
});
test.after(()=>{for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});

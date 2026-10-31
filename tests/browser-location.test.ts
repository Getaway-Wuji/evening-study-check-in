import test from 'node:test';
import assert from 'node:assert/strict';
import {browserLocation} from '../lib/browser-location';
import {defaultRules,checkLocation} from '../lib/domain';
const position=(accuracy:number,timestamp=Date.now())=>({coords:{latitude:31.2,longitude:121.4,accuracy},timestamp}) as GeolocationPosition;
function geolocation(watch:(success:PositionCallback,error:PositionErrorCallback)=>void,current?:(success:PositionCallback,error:PositionErrorCallback,options?:PositionOptions)=>void){
 const calls={clears:0,network:0,watches:0};
 const geo={watchPosition:(success:PositionCallback,error:PositionErrorCallback)=>{calls.watches++;queueMicrotask(()=>watch(success,error));return 7;},clearWatch:()=>{calls.clears++;},getCurrentPosition:(success:PositionCallback,error:PositionErrorCallback,options?:PositionOptions)=>{calls.network++;current?.(success,error,options);}} as Geolocation;
 return {geo,calls};
}
test('持续定位保留更准的样本，保留设备实际时间戳，并清理监听',async()=>{
 const at=Date.now()-2000,{geo,calls}=geolocation(success=>{success(position(150));success(position(80));success(position(20,at));success(position(5));});
 const result=await browserLocation({targetAccuracy:30,timeoutMs:100},geo);assert.equal(result.accuracy,20);assert.equal(result.capturedAt,at);assert.equal(calls.clears,1);assert.equal(calls.network,0);
});
test('一次高精度读取超时会尝试网络辅助，仍使用设备报告的真实精度',async()=>{
 const {geo,calls}=geolocation((_success,error)=>error({code:3} as GeolocationPositionError),(success,_error,options)=>{assert.equal(options?.enableHighAccuracy,false);assert.equal(options?.maximumAge,0);success(position(35));});
 const result=await browserLocation({targetAccuracy:50,timeoutMs:100},geo);assert.equal(result.accuracy,35);assert.equal(calls.network,1);assert.equal(calls.clears,1);
});
test('权限拒绝后立即停止，不再次请求网络定位',async()=>{
 const {geo,calls}=geolocation((_success,error)=>error({code:1} as GeolocationPositionError));await assert.rejects(browserLocation({timeoutMs:100},geo),/权限/);assert.equal(calls.network,0);assert.equal(calls.clears,1);
});
test('没有可靠结果时整体超时，监听和辅助定时器全部清理',async()=>{
 const {geo,calls}=geolocation(()=>{});await assert.rejects(browserLocation({timeoutMs:30},geo),/仍未取得可靠位置/);assert.equal(calls.clears,1);assert.equal(calls.network,1);
});
test('只有粗略结果时不伪造更高精度，服务器仍拒绝不达标位置',async()=>{
 const {geo}=geolocation(success=>success(position(120)));const result=await browserLocation({targetAccuracy:50,timeoutMs:30},geo);assert.equal(result.accuracy,120);assert.throws(()=>checkLocation(defaultRules,result),/精度/);
});
test('缓存过期或缺失时间戳的样本不会被重新包装成新定位',async()=>{
 const {geo}=geolocation(success=>{success(position(2,Date.now()-120000));success({...position(3),timestamp:undefined} as unknown as GeolocationPosition);success(position(25));});const result=await browserLocation({targetAccuracy:30,timeoutMs:100,maxAgeSeconds:15},geo);assert.equal(result.accuracy,25);
});
test('取消后停止监听，迟到的位置回调不会被采用',async()=>{
 let later:PositionCallback=()=>{};const {geo,calls}=geolocation(success=>{later=success;});const controller=new AbortController(),promise=browserLocation({signal:controller.signal,timeoutMs:100},geo);await Promise.resolve();controller.abort();await assert.rejects(promise,/已取消/);later(position(1));assert.equal(calls.clears,1);assert.equal(calls.network,0);
 const before=geolocation(()=>{});await assert.rejects(browserLocation({signal:controller.signal},before.geo),/已取消/);assert.equal(before.calls.watches,0);
});

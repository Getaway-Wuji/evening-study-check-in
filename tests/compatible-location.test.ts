import test from 'node:test';
import assert from 'node:assert/strict';
import {browserLocation} from '../lib/browser-location';
import {preferredLocationStrategy,locationReport} from '../lib/location-device';
import {checkLocation,defaultRules} from '../lib/domain';
import type {LocationDiagnostic} from '../lib/location';
const position=(accuracy:number,timestamp=Date.now())=>({coords:{latitude:31.2,longitude:121.4,accuracy},timestamp}) as GeolocationPosition;
function device(handler:(index:number,success:PositionCallback,error:PositionErrorCallback,options:PositionOptions)=>void){
  const calls:PositionOptions[]=[];let watches=0;
  const geo={getCurrentPosition:(success:PositionCallback,error:PositionErrorCallback,options:PositionOptions)=>{calls.push(options);handler(calls.length-1,success,error,options);},watchPosition:()=>{watches++;throw Error('Compatibility mode must not use watchPosition');}} as unknown as Geolocation;
  return {geo,calls,get watches(){return watches;}};
}
test('识别鸿蒙、ArkWeb 与华为浏览器，保留其他安卓和苹果的原定位策略',()=>{
  for(const ua of ['Android HUAWEI P60 MicroMessenger','Phone; HarmonyOS 6.0; HuaweiBrowser/16','Phone; OpenHarmony 5.0; ArkWeb/4'])assert.equal(preferredLocationStrategy(ua),'compatible');
  for(const ua of ['Android Chrome Mobile MicroMessenger','iPhone OS 18_0 Safari MicroMessenger'])assert.equal(preferredLocationStrategy(ua),'standard');
});
test('兼容模式从单次系统定位开始，只使用受有效期约束的真实缓存与时间戳',async()=>{
  const at=Date.now()-5000,d=device((_i,success)=>success(position(25,at)));
  const result=await browserLocation({strategy:'compatible',timeoutMs:100,maxAgeSeconds:10},d.geo);
  assert.equal(d.watches,0);assert.equal(d.calls.length,1);assert.equal(d.calls[0].enableHighAccuracy,false);assert.equal(d.calls[0].maximumAge,10000);assert.equal(result.capturedAt,at);assert.equal(result.accuracy,25);assert.equal(result.coordinateSystem,'wgs84');
});
test('系统返回粗略位置后再发起高精度单次请求，不同时启动持续监听',async()=>{
  const d=device((i,success)=>success(position(i?20:300)));
  const result=await browserLocation({strategy:'compatible',timeoutMs:100,targetAccuracy:50},d.geo);
  assert.equal(result.accuracy,20);assert.equal(d.calls.length,2);assert.equal(d.watches,0);assert.deepEqual(d.calls.map(c=>c.enableHighAccuracy),[false,true]);assert.equal(d.calls[1].maximumAge,0);
});
test('上一轮原生回调返回后才发起下一次请求，避免回调栈内再次调用定位桥接',async()=>{
  let inside=false;const d=device((i,success)=>{assert.equal(inside,false);inside=true;success(position(i?20:300));inside=false;});
  assert.equal((await browserLocation({strategy:'compatible',timeoutMs:100},d.geo)).accuracy,20);assert.equal(d.calls.length,2);
});
test('一个系统调用不回调时按分阶段期限继续尝试，旧回调不覆盖新结果',async()=>{
  let late:PositionCallback=()=>{};const events:LocationDiagnostic[]=[],d=device((i,success)=>{if(!i)late=success;else success(position(30));});
  const result=await browserLocation({strategy:'compatible',timeoutMs:180,onDiagnostic:e=>events.push(e)},d.geo);late(position(1));
  assert.equal(result.accuracy,30);assert.equal(d.calls.length,2);assert.ok(events.some(e=>e.outcome==='timeout'));assert.ok(!events.some(e=>e.accuracy===1));
});
test('前两次系统错误后仍可尝试一次不使用缓存的普通单次定位',async()=>{
  const d=device((i,success,error)=>i<2?error({code:i?3:2} as GeolocationPositionError):success(position(35)));
  const result=await browserLocation({strategy:'compatible',timeoutMs:100},d.geo);assert.equal(result.accuracy,35);assert.deepEqual(d.calls.map(c=>c.enableHighAccuracy),[false,true,false]);assert.equal(d.calls[2].maximumAge,0);
});
test('所有请求沉默时整体仍按预算结束，不无限延长或循环重试',async()=>{
  const d=device(()=>{});await assert.rejects(browserLocation({strategy:'compatible',timeoutMs:90},d.geo),/系统仍未返回可靠位置/);assert.ok(d.calls.length>=1&&d.calls.length<=3);assert.equal(d.watches,0);
});
test('权限拒绝立即结束，用户取消后不发起下一次请求',async()=>{
  const denied=device((_i,_success,error)=>error({code:1} as GeolocationPositionError));await assert.rejects(browserLocation({strategy:'compatible',timeoutMs:100},denied.geo),/权限/);assert.equal(denied.calls.length,1);
  const controller=new AbortController(),d=device(()=>{}),request=browserLocation({strategy:'compatible',timeoutMs:100,signal:controller.signal},d.geo);controller.abort();await assert.rejects(request,/取消/);await new Promise(r=>setTimeout(r,40));assert.equal(d.calls.length,1);
  const cancelled=device(()=>{});await assert.rejects(browserLocation({strategy:'compatible',signal:controller.signal},cancelled.geo),/取消/);assert.equal(cancelled.calls.length,0);
});
test('低精度、旧缓存及缺失精度不会被改写为可通过的位置',async()=>{
  const coarse=device((_i,success)=>success(position(180))),result=await browserLocation({strategy:'compatible',timeoutMs:100},coarse.geo);assert.equal(result.accuracy,180);assert.throws(()=>checkLocation(defaultRules,result),/精度不足/);
  const stale=device((i,success)=>success(i===0?position(1,Date.now()-120000):i===1?{...position(1),coords:{latitude:31.2,longitude:121.4,accuracy:undefined}} as unknown as GeolocationPosition:position(40)));
  assert.equal((await browserLocation({strategy:'compatible',timeoutMs:100,maxAgeSeconds:15},stale.geo)).accuracy,40);assert.equal(stale.calls.length,3);
});
test('脱敏诊断不复制设备坐标、账号字段或系统原始错误内容',()=>{
  const event={method:'single-balanced',outcome:'error',elapsedMs:12000,code:3,latitude:31.2,longitude:121.4,message:'private raw text'} as LocationDiagnostic;
  const report=locationReport({userAgent:'Fixture HarmonyOS',strategy:'compatible',elapsedMs:45000,status:'technical',permission:'granted',events:[event]});
  assert.ok(report.includes('location-v4'));assert.ok(report.includes('compatible'));assert.ok(!/latitude|longitude|private raw text|password|studentId/.test(report));
});

test('鸿蒙返回数据被拒绝时保留具体字段原因，不误报为系统未回调',async()=>{
  const events:LocationDiagnostic[]=[],d=device((_i,success)=>success({...position(20),timestamp:0}));
  await assert.rejects(browserLocation({strategy:'compatible',timeoutMs:100,onDiagnostic:e=>events.push(e)},d.geo),/已返回定位数据.*采集时间格式无效/);
  const invalid=events.filter(e=>e.outcome==='invalid');assert.equal(invalid.length,3);assert.ok(invalid.every(e=>e.sample?.issue==='invalid-timestamp'&&e.sample.timestampValue===0&&e.sample.coordinates==='valid'));
});

test('兼容策略接受原值为数字文本的毫秒采集时间，保留真实精度与时间',async()=>{
  const at=Date.now()-2000,d=device((_i,success)=>success({...position(20),timestamp:String(at)} as unknown as GeolocationPosition));
  const result=await browserLocation({strategy:'compatible',timeoutMs:100},d.geo);assert.equal(result.capturedAt,at);assert.equal(result.accuracy,20);
});

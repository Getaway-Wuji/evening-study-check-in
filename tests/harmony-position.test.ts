import test from 'node:test';
import assert from 'node:assert/strict';
import {harmonyPosition} from '../lib/harmony-position';
import {browserLocation} from '../lib/browser-location';
import {checkLocation,defaultRules,wgsToGcj} from '../lib/domain';
const now=1800000000000,raw=(timestamp=10000,accuracy=13.5)=>({timestamp,coords:{latitude:31.2,longitude:121.4,accuracy}}),request={enabled:true,maximumAge:0,startedAt:now-2500};

test('复现鸿蒙固定 10000 时间戳，只以新无缓存请求的开始时间作为保守边界并保留来源',()=>{
  const result=harmonyPosition(raw(),60000,request,now);assert.equal(result.position?.capturedAt,request.startedAt);assert.equal(result.position?.accuracy,13.5);assert.equal(result.position?.timeBasis,'fresh-request');assert.equal(result.position?.deviceTimestamp,10000);
  assert.equal(result.sample.timestampValue,10000);assert.equal(result.sample.timeBasis,'fresh-request');assert.equal(result.sample.effectiveAgeMs,2500);
});

test('缓存请求、其他设备、缺失和任意过期时间都不能套用固定异常值兼容',()=>{
  for(const ctx of [{...request,enabled:false},{...request,maximumAge:15000},{...request,startedAt:now-60001},{...request,startedAt:now+1}])assert.equal(harmonyPosition(raw(),60000,ctx,now).position,undefined);
  for(const timestamp of [0,10001,now-120000,now/1000,now*1000])assert.equal(harmonyPosition(raw(timestamp),60000,request,now).position,undefined);
  assert.equal(harmonyPosition({coords:raw().coords},60000,request,now).position,undefined);
  const ordinary=harmonyPosition(raw(now-1000),60000,request,now);assert.equal(ordinary.position?.capturedAt,now-1000);assert.equal(ordinary.position?.timeBasis,undefined);
});

test('鸿蒙时间兼容仍受原有精度、范围、有效期及来源标记校验',()=>{
  const p=harmonyPosition(raw(),60000,request,now).position!,[latitude,longitude]=wgsToGcj(p.latitude,p.longitude),rules={...defaultRules,latitude,longitude};
  assert.doesNotThrow(()=>checkLocation(rules,p,now));assert.throws(()=>checkLocation(rules,{...p,accuracy:150},now),/精度/);assert.throws(()=>checkLocation(rules,{...p,latitude:p.latitude+0.02},now),/超出/);
  assert.throws(()=>checkLocation(rules,p,request.startedAt+60001),/过期/);assert.throws(()=>checkLocation(rules,{...p,deviceTimestamp:10001},now),/来源/);assert.throws(()=>checkLocation(rules,{...p,coordinateSystem:'gcj02'},now),/来源/);
});

test('端到端兼容采集先拒绝缓存样本，再发起 maximumAge:0 请求处理已知异常',async()=>{
  const calls:PositionOptions[]=[],geo={getCurrentPosition:(success:PositionCallback,_error:PositionErrorCallback,options:PositionOptions)=>{calls.push(options);success(raw() as GeolocationPosition);},watchPosition:()=>{throw Error('Unexpected watch');}} as unknown as Geolocation;
  const before=Date.now(),result=await browserLocation({strategy:'compatible',harmonyClockWorkaround:true,timeoutMs:200},geo);
  assert.equal(calls.length,2);assert.ok(calls[0].maximumAge!>0);assert.equal(calls[1].maximumAge,0);assert.equal(result.timeBasis,'fresh-request');assert.equal(result.deviceTimestamp,10000);assert.ok(result.capturedAt>=before&&result.capturedAt<=Date.now());
});

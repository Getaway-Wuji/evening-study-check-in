import test from 'node:test';
import assert from 'node:assert/strict';
import {browserPosition} from '../lib/browser-position';
import {locationReport} from '../lib/location-device';
const now=1800000000000,position=(timestamp:unknown,accuracy:unknown=20)=>({timestamp,coords:{latitude:31.2,longitude:121.4,accuracy}});

test('正确读取标准字段和原值为数字文本的桥接字段，不改写采集时间',()=>{
  const normal=browserPosition(position(now-5000),60000,now);assert.equal(normal.position?.capturedAt,now-5000);
  const decoded=browserPosition({timestamp:String(now-7000),coords:{latitude:'31.2',longitude:'121.4',accuracy:'25.5'}},60000,now);
  assert.deepEqual(decoded.position,{latitude:31.2,longitude:121.4,accuracy:25.5,capturedAt:now-7000,coordinateSystem:'wgs84'});assert.equal(decoded.sample.timestampType,'string');
});

test('时间字段缺失、为零、超期、在未来或单位异常都明确拒绝，不用当前时间补齐',()=>{
  const cases:[unknown,string][]=[[undefined,'missing-timestamp'],[null,'missing-timestamp'],[0,'invalid-timestamp'],['','invalid-timestamp'],['invalid','invalid-timestamp'],[true,'invalid-timestamp'],[now-60001,'stale-timestamp'],[now+10001,'future-timestamp'],[now/1000,'stale-timestamp'],[now*1000,'future-timestamp']];
  for(const [value,issue]of cases){const result=browserPosition(position(value),60000,now);assert.equal(result.position,undefined,String(value));assert.equal(result.sample.issue,issue,String(value));}
});

test('区分坐标、精度和不可读返回值问题，诊断不包含坐标或原始字符串',()=>{
  const samples=[browserPosition(null,60000,now),browserPosition({timestamp:now},60000,now),browserPosition({timestamp:now,coords:{latitude:200,longitude:121.4,accuracy:20}},60000,now),browserPosition(position(now,0),60000,now),browserPosition(position('private raw timestamp',undefined),60000,now),browserPosition({get timestamp(){throw Error('private error');}},60000,now)];
  assert.deepEqual(samples.map(s=>s.sample.issue),['unreadable-position','missing-coordinates','invalid-coordinates','invalid-accuracy','invalid-timestamp','unreadable-position']);
  for(const result of samples){assert.equal(result.position,undefined);assert.ok(!/latitude|longitude|private/.test(JSON.stringify(result.sample)));}
});

test('诊断使用明确字段白名单，额外位置和身份字段不会进入可复制内容',()=>{
  const sample={...browserPosition(position(0),60000,now).sample,latitude:31.2,longitude:121.4,studentId:'private-id',message:'private-error'};
  const report=locationReport({userAgent:'Fixture ArkWeb',strategy:'compatible',elapsedMs:6000,status:'technical',permission:'granted',events:[{method:'single-high',outcome:'invalid',elapsedMs:2000,sample}]});
  assert.ok(report.includes('invalid-timestamp'));assert.ok(report.includes('timestampValue'));assert.ok(!/latitude|longitude|studentId|private/.test(report));
});

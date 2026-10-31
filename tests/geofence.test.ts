import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRules,wgsToGcj,checkLocation,distanceMeters} from '../lib/domain';
import {gcjToWgs,fenceRing,assessFence,validFence} from '../lib/geofence';
const r={...defaultRules,latitude:31.2304,longitude:121.4737,radius:100};
test('地图坐标转换可往返，不把 GCJ-02 直接叠加到 WGS84 底图',()=>{
 for(const point of [[31.2304,121.4737],[39.9,116.4],[22.5,114],[51.5,-.1]] as [number,number][]){const gcj=wgsToGcj(...point),back=gcjToWgs(...gcj);assert.ok(distanceMeters(...point,...back)<0.02);}
});
test('圈上采样点与服务器同坐标系距离一致，内外点不能颠倒',()=>{
 for(const [latitude,longitude] of fenceRing(r))assert.ok(Math.abs(distanceMeters(r.latitude,r.longitude,latitude,longitude)-r.radius)<0.001);
 for(const radius of [99,101]){const [latitude,longitude]=fenceRing({...r,radius})[10],sample={latitude,longitude,accuracy:10,capturedAt:Date.now(),coordinateSystem:'gcj02' as const},result=assessFence(r,sample);assert.equal(result.inside,radius<100);assert.equal(result.eligible,radius<100);if(radius>100)assert.throws(()=>checkLocation(r,sample),/超出/);}
});
test('在圆内也不能绕过精度和过期要求，未填坐标不展示假地点',()=>{
 const sample={latitude:r.latitude,longitude:r.longitude,accuracy:100,capturedAt:Date.now(),coordinateSystem:'gcj02' as const};assert.equal(assessFence(r,sample).inside,true);assert.equal(assessFence(r,sample).eligible,false);assert.equal(assessFence(r,{...sample,accuracy:5,capturedAt:Date.now()-120000}).eligible,false);assert.equal(validFence(defaultRules),false);assert.equal(validFence(r),true);
 assert.throws(()=>checkLocation(r,{...sample,accuracy:NaN}),/数据无效/);assert.throws(()=>checkLocation(r,{...sample,latitude:NaN}),/数据无效/);
});

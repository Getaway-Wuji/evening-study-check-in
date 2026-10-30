import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules,period,checkLocation,dateCN,safeCSV,wgsToGcj } from '../lib/domain';
const date='2026-10-30',at=(time:string)=>Date.parse(`${date}T${time}+08:00`);
test('北京时间窗口包含截止分钟，覆盖规则不改变默认窗口',()=>{
  assert.equal(dateCN(at('00:00:00')),date);
  for(const [time,expected] of [['17:29:59','before'],['17:30:00','open'],['18:05:59','open'],['18:06:00','closed']] as const)assert.equal(period(date,defaultRules,at(time)),expected);
  assert.equal(period(date,{...defaultRules,close:'18:15'},at('18:10:00')),'open');
  assert.equal(period(date,defaultRules,at('18:10:00')),'closed');
  assert.equal(period(date,{...defaultRules,close:'18:15'},at('18:16:00')),'closed');
});
test('后台范围验证拒绝过期、精度不足和范围外坐标',()=>{
  const now=Date.now(),loc={latitude:defaultRules.latitude,longitude:defaultRules.longitude,accuracy:10,capturedAt:now,coordinateSystem:'gcj02' as const};
  assert.equal(checkLocation(defaultRules,loc,now).distance,0);
  assert.throws(()=>checkLocation(defaultRules,{...loc,capturedAt:now-61000},now),/过期/);
  assert.throws(()=>checkLocation(defaultRules,{...loc,capturedAt:now+11000},now),/过期/);
  assert.throws(()=>checkLocation(defaultRules,{...loc,accuracy:51},now),/精度/);
  assert.throws(()=>checkLocation(defaultRules,{...loc,latitude:loc.latitude+.01},now),/超出/);
  assert.deepEqual(wgsToGcj(0,0),[0,0]);
});
test('导出对公式注入和 CSV 引号进行转义',()=>{
  assert.equal(safeCSV('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
  assert.equal(safeCSV('张,同学'),'"张,同学"');
});

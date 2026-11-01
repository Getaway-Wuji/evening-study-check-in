import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {dateCN,defaultRules,wgsToGcj} from '../lib/domain';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/harmony-checkin-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {ready,db,run,one}=await import('../lib/db');
const {createSession,command}=await import('../lib/service');
await ready();
const user={id:'fixture-harmony',code:'H001',name:'虚构定位测试同学',role:'student'};
await run('INSERT INTO users(id,code,name,role,created_at) VALUES(?,?,?,?,?)',[user.id,user.code,user.name,user.role,Date.now()]);
const [latitude,longitude]=wgsToGcj(31.2,121.4),rules={...defaultRules,latitude,longitude,open:'00:00',close:'23:59',locationConfirmed:true},sessionId=await createSession(dateCN(),db(),rules);

test('正式打卡保留鸿蒙时间异常来源，仍拒绝超期、低精度、越界和错误来源',async()=>{
  const sample={sessionId,latitude:31.2,longitude:121.4,accuracy:13.5,capturedAt:Date.now()-2000,coordinateSystem:'wgs84',timeBasis:'fresh-request',deviceTimestamp:10000};
  for(const [patch,message]of [[{capturedAt:Date.now()-61000},/过期/],[{accuracy:150},/精度/],[{latitude:31.22},/超出/],[{deviceTimestamp:10001},/来源/]] as const)await assert.rejects(command(user,{action:'checkin',data:{...sample,...patch}}),message);
  assert.equal((await one('SELECT COUNT(*) n FROM checkins')).n,0);
  const result=await command(user,{action:'checkin',data:sample}),record=await one('SELECT * FROM checkins WHERE id=?',[result.id]);
  assert.equal(record.captured_at,sample.capturedAt);assert.equal(record.accuracy,13.5);const source=JSON.parse(record.source_coords);assert.equal(source.timeBasis,'fresh-request');assert.equal(source.deviceTimestamp,10000);
  const log=await one("SELECT detail FROM audit_logs WHERE action='打卡成功'");assert.ok(log.detail.includes('fresh-request'));
});
test.after(()=>db().close());

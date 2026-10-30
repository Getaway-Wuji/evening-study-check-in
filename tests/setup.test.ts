import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
mkdirSync('.local',{recursive:true});process.env.DATABASE_URL=`file:./.local/setup-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
const {needsSetup,initializeClass,localSetupAllowed}=await import('../lib/setup');
const {db,one,businessNow,demoMode}=await import('../lib/db');
test('真实初始化只创建管理员，不填入虚构学生和考勤',async()=>{
  assert.equal(await needsSetup(),true);
  const password='Setup-test-'+crypto.randomUUID();
  const results=await Promise.allSettled([initializeClass({className:'真实流程测试班',username:'owner',password}),initializeClass({className:'重复请求',username:'owner2',password})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await needsSetup(),false);
  assert.equal((await one('SELECT COUNT(*) n FROM users')).n,1);assert.equal((await one('SELECT COUNT(*) n FROM sessions')).n,0);
  assert.equal(JSON.parse((await one('SELECT value FROM settings WHERE id=1')).value).capacity,null);
  assert.equal(demoMode(),false);assert.ok(Math.abs(businessNow()-Date.now())<1000);
});
test('初始化不允许覆盖已有管理员，生产环境不能开放无凭证初始化',async()=>{
  await assert.rejects(initializeClass({className:'覆盖',username:'other',password:'Another-test-'+crypto.randomUUID()}),/已完成初始化/);
  const previous=process.env.NODE_ENV||'test';Object.assign(process.env,{NODE_ENV:'production'});assert.equal(localSetupAllowed(),false);Object.assign(process.env,{NODE_ENV:previous});
});
test.after(()=>db().close());

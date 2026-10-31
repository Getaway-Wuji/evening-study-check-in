import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {wechatSetup} from '../lib/wechat-config';
import {readLocation,wechatSignatureURL} from '../lib/location';
mkdirSync('.local',{recursive:true});
process.env.DATABASE_URL=`file:./.local/wechat-${crypto.randomUUID()}.db`;process.env.DEMO_MODE='false';
process.env.APP_URL='https://study.example.test/';process.env.WECHAT_APP_ID='wx'+'0'.repeat(16);process.env.WECHAT_APP_SECRET='fixture-'+crypto.randomUUID();
process.env.WECHAT_OAUTH_ENABLED='true';process.env.WECHAT_LOCATION_ENABLED='true';
const {db,run}=await import('../lib/db');
const {wechatAuthorizeURL,exchangeWechatCode,signWechatURL,checkWechatConnection}=await import('../lib/wechat');
const originalFetch=globalThis.fetch;
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('公众号网页授权和定位分别启用，配置状态不包含密钥',()=>{
  const env={APP_URL:process.env.APP_URL,WECHAT_APP_ID:process.env.WECHAT_APP_ID,WECHAT_APP_SECRET:process.env.WECHAT_APP_SECRET,WECHAT_OAUTH_ENABLED:'false',WECHAT_LOCATION_ENABLED:'true'};
  const status=wechatSetup(env);assert.equal(status.oauthConfigured,false);assert.equal(status.locationConfigured,true);
  assert.equal(status.menuURL,'https://study.example.test/wechat');assert.ok(!JSON.stringify(status).includes(env.WECHAT_APP_SECRET!));
  assert.equal(wechatSetup({...env,APP_URL:'http://study.example.test'}).locationConfigured,false);
  assert.equal(wechatSetup({...env,WECHAT_APP_ID:'invalid'}).locationConfigured,false);
});
test('授权地址使用正式域名、最小 scope 和随机 state，不携带密钥',()=>{
  const state=crypto.randomUUID(),url=wechatAuthorizeURL(state);
  assert.equal(url.origin,'https://open.weixin.qq.com');assert.equal(url.hash,'#wechat_redirect');
  assert.equal(url.searchParams.get('redirect_uri'),'https://study.example.test/api/auth/wechat/callback');
  assert.equal(url.searchParams.get('state'),state);assert.equal(url.searchParams.get('scope'),'snsapi_base');
  assert.ok(!url.href.includes(process.env.WECHAT_APP_SECRET!));
});
test('服务端换取身份只返回 OpenID，不向网页返回授权令牌',async()=>{
  globalThis.fetch=(async input=>{assert.equal(new URL(String(input)).origin,'https://api.weixin.qq.com');return json({openid:'fixture-openid',access_token:'private-fixture-access',refresh_token:'private-fixture-refresh'});}) as typeof fetch;
  assert.equal(await exchangeWechatCode('fixture-code'),'fixture-openid');
});
test('并发页面共用缓存票据，签名保留原查询顺序和编码并排除 hash',async()=>{
  let calls=0;const ticket='fixture-ticket-'+crypto.randomUUID();
  globalThis.fetch=(async input=>{calls++;return String(input).includes('stable_token')?json({access_token:'fixture-token'}):json({ticket,expires_in:7200});}) as typeof fetch;
  const page='https://study.example.test/student?b=%2F&a=1#section';
  const signatures=await Promise.all([signWechatURL(page),signWechatURL('https://study.example.test/student/leave')]);
  assert.equal(calls,2);
  for(const [index,value] of signatures.entries()){
    const url=index===0?page.split('#')[0]:'https://study.example.test/student/leave';
    assert.equal(value.signature,createHash('sha1').update(`jsapi_ticket=${ticket}&noncestr=${value.nonceStr}&timestamp=${value.timestamp}&url=${url}`).digest('hex'));
    assert.ok(!JSON.stringify(value).includes(ticket));
  }
  await signWechatURL(page);assert.equal(calls,2);
  await assert.rejects(signWechatURL('https://outside.example.test/student'),/本站/);assert.equal(calls,2);
  await assert.rejects(signWechatURL('https://user:pass@study.example.test/student'),/本站/);
});
test('IP 白名单和接口权限错误可诊断，上游敏感文本不会回传，失败后可重试',async()=>{
  await run('DELETE FROM integration_cache');
  let code=40164;
  globalThis.fetch=(async()=>json({errcode:code,errmsg:'private-upstream-'+process.env.WECHAT_APP_SECRET})) as typeof fetch;
  const ip=await checkWechatConnection();assert.equal(ip.ok,false);assert.match(ip.message,/IP 白名单/);assert.ok(!JSON.stringify(ip).includes(process.env.WECHAT_APP_SECRET!));
  code=48001;const permission=await checkWechatConnection();assert.equal(permission.ok,false);assert.match(permission.message,/接口权限/);
  globalThis.fetch=(async input=>String(input).includes('stable_token')?json({access_token:'fixture-token'}):json({ticket:'fixture-retry-ticket',expires_in:7200})) as typeof fetch;
  assert.equal((await checkWechatConnection()).ok,true);
});
test('定位票据未接通时不调用微信接口，不将系统定位冒充微信定位',async()=>{
  process.env.WECHAT_LOCATION_ENABLED='false';let calls=0;
  globalThis.fetch=(async()=>{calls++;return json({});}) as typeof fetch;
  assert.equal((await checkWechatConnection()).ok,false);await assert.rejects(signWechatURL('https://study.example.test/student'),/尚未配置/);assert.equal(calls,0);
  process.env.WECHAT_LOCATION_ENABLED='true';
});
test('iOS 入口地址与 Android 当前地址分别签名，hash 不参与签名',()=>{
  assert.equal(wechatSignatureURL('iPhone MicroMessenger','https://study.example.test/student/leave#x','https://study.example.test/student?from=menu'),'https://study.example.test/student?from=menu');
  assert.equal(wechatSignatureURL('Android MicroMessenger','https://study.example.test/student/leave#x','https://study.example.test/student'),'https://study.example.test/student/leave');
});
test('微信和系统定位保留坐标系，缺失或虚假的精度不会自动补成可通过值',()=>{
  const raw={latitude:'31.1',longitude:'121.2',accuracy:'25'};
  assert.deepEqual(readLocation(raw,'gcj02',123),{latitude:31.1,longitude:121.2,accuracy:25,capturedAt:123,coordinateSystem:'gcj02'});
  for(const accuracy of [null,undefined,'',0,-1,'bad',Infinity])assert.throws(()=>readLocation({...raw,accuracy},'wgs84'),/精度/);
  assert.throws(()=>readLocation({...raw,latitude:91},'wgs84'),/坐标/);
});
test.after(()=>{globalThis.fetch=originalFetch;db().close();});

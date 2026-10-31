import {createHash} from 'node:crypto';
import {one,run,ready} from './db';
import {token} from './auth';
import {wechatSetup} from './wechat-config';
export {wechatSetup} from './wechat-config';
export function wechatReady(){return wechatSetup().oauthConfigured;}
export class WechatAPIError extends Error{
  constructor(public code:number,public operation:string){
    const detail=code===40164?'请配置微信接口调用 IP 白名单；动态出口需要固定出口接入':
      [48001,48002,50001].includes(code)?'公众号尚未获得这项接口权限，请在公众平台核对':
      [40013,40125,40001].includes(code)?'公众号 AppID、AppSecret 或接口凭据无效，请核对服务器配置':
      [40029,40163].includes(code)?'微信授权码已失效，请从公众号菜单重新进入':'公众号接口暂时不可用，请稍后重试';
    super(`${detail}（微信错误码 ${code}）`);
  }
}
async function wxJSON(url:string,operation:string,body?:unknown){
  let response:Response,result:Record<string,unknown>;
  try{
    response=await fetch(url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
    result=await response.json();
  }catch{throw new Error('连接微信接口超时或失败，请稍后重试');}
  // Never expose upstream bodies or request URLs: either can contain credentials or addresses.
  if(!result||typeof result!=='object')throw new Error('微信接口返回格式异常');
  if(result.errcode)throw new WechatAPIError(Number(result.errcode)||-1,operation);
  if(!response.ok)throw new Error('微信接口暂时不可用，请稍后重试');
  return result;
}
export function wechatAuthorizeURL(state:string){
  const config=wechatSetup();if(!config.oauthConfigured)throw new Error('公众号网页授权尚未配置');
  const url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.search=new URLSearchParams({appid:process.env.WECHAT_APP_ID!.trim(),redirect_uri:config.callbackURL,response_type:'code',scope:'snsapi_base',state}).toString();
  url.hash='wechat_redirect';return url;
}
export async function exchangeWechatCode(code:string){
  if(!wechatReady())throw new Error('公众号登录尚未配置，可先使用账号登录');
  const url=new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  url.search=new URLSearchParams({appid:process.env.WECHAT_APP_ID!.trim(),secret:process.env.WECHAT_APP_SECRET!.trim(),code,grant_type:'authorization_code'}).toString();
  const result=await wxJSON(url.toString(),'oauth');
  if(typeof result.openid!=='string'||!result.openid)throw new Error('微信登录凭证无效，请重新进入');
  return result.openid;
}
const ticketFlights=new Map<string,Promise<string>>();
async function jsapiTicket():Promise<string>{
  await ready();
  const key='jsapi:'+process.env.WECHAT_APP_ID!.trim();
  const old=await one('SELECT value FROM integration_cache WHERE key=? AND expires_at>?',[key,Date.now()]);
  if(old)return old.value;
  const pending=ticketFlights.get(key);if(pending)return pending;
  const flight=(async()=>{
    const auth=await wxJSON('https://api.weixin.qq.com/cgi-bin/stable_token','stable-token',{grant_type:'client_credential',appid:process.env.WECHAT_APP_ID!.trim(),secret:process.env.WECHAT_APP_SECRET!.trim(),force_refresh:false});
    if(typeof auth.access_token!=='string'||!auth.access_token)throw new Error('微信未返回接口调用凭据');
    const response=await wxJSON(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${encodeURIComponent(auth.access_token)}&type=jsapi`,'jsapi-ticket');
    if(typeof response.ticket!=='string'||!response.ticket||!Number.isFinite(Number(response.expires_in))||Number(response.expires_in)<=0)throw new Error('公众号定位接口未返回有效票据');
    const ttl=Math.max(1,Number(response.expires_in)-Math.min(300,Number(response.expires_in)/10));
    await run('INSERT INTO integration_cache(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at',[key,response.ticket,Date.now()+ttl*1000]);
    return response.ticket;
  })();
  ticketFlights.set(key,flight);
  try{return await flight;}finally{if(ticketFlights.get(key)===flight)ticketFlights.delete(key);}
}
export function unsignedWechatURL(url:string,origin=wechatSetup().origin){
  const raw=url.split('#')[0],parsed=new URL(raw);
  if(parsed.origin!==origin||parsed.username||parsed.password||parsed.protocol!=='https:')throw new Error('只能为本站 HTTPS 网页签名');
  return raw;
}
export async function signWechatURL(url:string){
  if(!wechatSetup().locationConfigured)throw new Error('公众号微信定位尚未配置，请使用系统定位或联系管理员');
  const unsigned=unsignedWechatURL(url);
  const nonceStr=token().slice(0,20),timestamp=Math.floor(Date.now()/1000),ticket=await jsapiTicket();
  const signature=createHash('sha1').update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${unsigned}`).digest('hex');
  return {appId:process.env.WECHAT_APP_ID!.trim(),nonceStr,timestamp,signature};
}
export async function checkWechatConnection(){
  const config=wechatSetup();
  if(!config.locationConfigured)return {...config,ok:false,message:'微信定位未启用或缺少配置。请先核对接口权限，再设置服务器变量。'};
  try{await jsapiTicket();return {...config,ok:true,message:'服务器已取得 JS-SDK 票据。还需在微信真机验证域名签名、定位权限和精度；此检测不代表网页授权已获准。'};}
  catch(error){return {...config,ok:false,message:error instanceof Error?error.message:'微信连接检测失败',...(error instanceof WechatAPIError?{wechatCode:error.code}:{})};}
}

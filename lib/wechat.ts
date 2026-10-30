import { createHash } from 'node:crypto';
import { one,run } from './db';
import { token } from './auth';
export function wechatReady(){return !!(process.env.WECHAT_APP_ID&&process.env.WECHAT_APP_SECRET&&process.env.APP_URL?.startsWith('https://'));}
async function wxJSON(url:string,body?:unknown){
  const response=await fetch(url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(8000)});
  const result=await response.json();
  if(!response.ok||result.errcode)throw new Error('公众号接口暂时不可用，请检查账号权限、域名和接口白名单');
  return result;
}
export async function exchangeWechatCode(code:string){
  if(!wechatReady())throw new Error('公众号登录尚未配置，可先使用账号登录');
  const url=new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  url.search=new URLSearchParams({appid:process.env.WECHAT_APP_ID!,secret:process.env.WECHAT_APP_SECRET!,code,grant_type:'authorization_code'}).toString();
  const result=await wxJSON(url.toString());
  if(typeof result.openid!=='string')throw new Error('微信登录凭证无效，请重新登录');
  return result.openid as string;
}
let ticketFlight:Promise<string>|undefined;
async function jsapiTicket():Promise<string>{
  const key='jsapi:'+process.env.WECHAT_APP_ID,old=await one('SELECT value FROM integration_cache WHERE key=? AND expires_at>?',[key,Date.now()]);
  if(old)return old.value;
  if(ticketFlight)return ticketFlight;
  ticketFlight=(async()=>{
    // stable_token 配合数据库缓存，避免跨函数实例频繁刷新普通 access_token。
    const auth=await wxJSON('https://api.weixin.qq.com/cgi-bin/stable_token',{grant_type:'client_credential',appid:process.env.WECHAT_APP_ID,secret:process.env.WECHAT_APP_SECRET,force_refresh:false});
    const response=await wxJSON(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${encodeURIComponent(auth.access_token)}&type=jsapi`);
    if(!response.ticket)throw new Error('公众号定位接口尚未开通');
    await run('INSERT INTO integration_cache(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at',[key,response.ticket,Date.now()+(Number(response.expires_in)-300)*1000]);
    return response.ticket as string;
  })();
  try{return await ticketFlight;}finally{ticketFlight=undefined;}
}
export async function signWechatURL(url:string){
  if(!wechatReady())throw new Error('公众号定位尚未配置');
  const parsed=new URL(url),base=new URL(process.env.APP_URL!);
  if(parsed.origin!==base.origin)throw new Error('只能为本站网页签名');
  parsed.hash='';
  const nonceStr=token().slice(0,20),timestamp=Math.floor(Date.now()/1000),ticket=await jsapiTicket();
  const signature=createHash('sha1').update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${parsed.toString()}`).digest('hex');
  return {appId:process.env.WECHAT_APP_ID,nonceStr,timestamp,signature};
}

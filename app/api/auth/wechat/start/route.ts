import { NextRequest,NextResponse } from 'next/server';
import { token,hash,errorResponse,rateLimit } from '@/lib/auth';
import { ready,one,run,audit } from '@/lib/db';
import { wechatReady } from '@/lib/wechat';
export async function GET(req:NextRequest){
  try{
    await ready();await rateLimit(req,'wechat-start',200);
    if(!wechatReady())return NextResponse.redirect(new URL('/login?notice=wechat-unavailable',req.url));
    const state=token(),url=new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    url.search=new URLSearchParams({appid:process.env.WECHAT_APP_ID!,redirect_uri:process.env.APP_URL+'/api/auth/wechat/callback',response_type:'code',scope:'snsapi_base',state}).toString();
    url.hash='wechat_redirect';
    const res=NextResponse.redirect(url);res.cookies.set('wechat_oauth_state',state,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:600,path:'/'});return res;
  }catch(e){return errorResponse(e);}
}

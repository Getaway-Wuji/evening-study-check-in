import { NextRequest,NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { token,hash,signIn } from '@/lib/auth';
import { ready,one,run,audit } from '@/lib/db';
import { exchangeWechatCode,WechatAPIError,wechatSetup } from '@/lib/wechat';
export async function GET(req:NextRequest){
  const base=wechatSetup().origin||req.nextUrl.origin;
  try{
    const state=req.nextUrl.searchParams.get('state'),expected=(await cookies()).get('wechat_oauth_state')?.value,code=req.nextUrl.searchParams.get('code');
    (await cookies()).delete('wechat_oauth_state');
    if(!state||!expected||hash(state)!==hash(expected)||!code||code.length>512)throw new Error('invalid');
    await ready();const openid=await exchangeWechatCode(code),user=await one('SELECT id,role,active FROM users WHERE openid=?',[openid]);
    if(user){if(!user.active)throw new Error('disabled');await audit(user.id,'公众号微信登录',{});return signIn(user.id,NextResponse.redirect(new URL(user.role==='admin'?'/admin':'/student',base)));}
    const pending=token();await run('INSERT INTO wechat_pending(token_hash,openid,expires_at) VALUES(?,?,?)',[hash(pending),openid,Date.now()+600000]);
    const res=NextResponse.redirect(new URL('/bind',base));res.cookies.set('wechat_pending',pending,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:600,path:'/'});return res;
  }catch(error){const notice=error instanceof WechatAPIError&&[48001,48002,50001].includes(error.code)?'wechat-permission':'wechat-failed';return NextResponse.redirect(new URL('/login?notice='+notice,base));}
}

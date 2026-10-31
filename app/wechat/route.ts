import {NextRequest,NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {wechatReady,wechatSetup} from '@/lib/wechat';
export async function GET(req:NextRequest){
  const base=wechatSetup().origin||req.nextUrl.origin;
  if(wechatReady()&&/MicroMessenger/i.test(req.headers.get('user-agent')||''))return NextResponse.redirect(new URL('/api/auth/wechat/start',base));
  const user=await currentUser();
  return NextResponse.redirect(new URL(user?user.role==='admin'?'/admin':'/student':wechatReady()?'/login?notice=wechat-in-app':'/login',base));
}

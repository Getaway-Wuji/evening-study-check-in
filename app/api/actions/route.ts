import { NextRequest,NextResponse } from 'next/server';
import { requireUser,errorResponse,sameOrigin,rateLimit } from '@/lib/auth';
import { command } from '@/lib/service';
import { processMailJobs,wakeEmail } from '@/lib/mail';
export const maxDuration=30;
export async function POST(req:NextRequest){
  try{sameOrigin(req);const user=await requireUser();await rateLimit(req,'actions:'+user.id,80);
    const raw=await req.text();if(raw.length>40000)throw new Error('提交内容过长');
    const result=await command(user,JSON.parse(raw));
    if(result.mailJob){try{await processMailJobs(1);await wakeEmail();}catch{/* 已持久保存，后台仍可重试。 */}}
    return NextResponse.json(result);
  }catch(e){return errorResponse(e);}
}

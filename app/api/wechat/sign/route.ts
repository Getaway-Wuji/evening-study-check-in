import { NextRequest,NextResponse } from 'next/server';
import { requireUser,errorResponse,sameOrigin,rateLimit } from '@/lib/auth';
import { signWechatURL } from '@/lib/wechat';
export async function POST(req:NextRequest){try{sameOrigin(req);await requireUser();await rateLimit(req,'wechat-sign',60);const {url}=await req.json();if(typeof url!=='string'||url.length>2000)throw new Error('网页地址无效');return NextResponse.json(await signWechatURL(url));}catch(e){return errorResponse(e);}}

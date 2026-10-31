import {NextRequest,NextResponse} from 'next/server';
import {requireUser,sameOrigin,errorResponse,rateLimit} from '@/lib/auth';
import {wechatSetup,checkWechatConnection} from '@/lib/wechat';
export async function GET(){try{await requireUser('admin');return NextResponse.json(wechatSetup(),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{sameOrigin(req);await requireUser('admin');await rateLimit(req,'wechat-connection-check',12);return NextResponse.json(await checkWechatConnection(),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

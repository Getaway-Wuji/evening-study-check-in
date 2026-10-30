import { NextRequest,NextResponse } from 'next/server';
import { hash,sameOrigin,errorResponse,rateLimit,signIn,HTTPError } from '@/lib/auth';
import { ready } from '@/lib/db';
import { localSetupAllowed,initializeClass } from '@/lib/setup';
export async function POST(req:NextRequest){try{
  sameOrigin(req);await ready();await rateLimit(req,'initial-setup',10);
  const raw=await req.text();if(raw.length>5000)throw new Error('提交内容过长');
  const data=JSON.parse(raw),configured=process.env.SETUP_TOKEN;
  if(configured){if(typeof data.setupToken!=='string'||hash(data.setupToken)!==hash(configured))throw new HTTPError(403,'初始化凭证不正确');}
  else if(!localSetupAllowed())throw new HTTPError(403,'请由项目负责人先配置初始化凭证，或从受控终端创建管理员');
  const admin=await initializeClass(data);
  return signIn(admin.id,NextResponse.json({next:'/admin/schedule',message:'班级已初始化，请设置学期并录入真实名单'}));
}catch(e){return errorResponse(e);}}

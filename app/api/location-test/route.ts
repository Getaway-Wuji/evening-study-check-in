import {NextRequest,NextResponse} from 'next/server';
import {requireUser,errorResponse,sameOrigin,rateLimit} from '@/lib/auth';
import {locationTestContext,testStudentLocation} from '@/lib/location-test';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){try{return NextResponse.json(await locationTestContext(await requireUser('student')),{headers});}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{
  sameOrigin(req);const user=await requireUser('student');await rateLimit(req,'location-test:'+user.id,60);
  const raw=await req.text();if(raw.length>4096)throw new Error('定位测试数据过长');
  return NextResponse.json(await testStudentLocation(user,JSON.parse(raw)),{headers});
}catch(error){return errorResponse(error);}}

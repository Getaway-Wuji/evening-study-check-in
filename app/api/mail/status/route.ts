import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser,sameOrigin,errorResponse,rateLimit} from '@/lib/auth';
import {mailStatus,sendMailTest} from '@/lib/mail-settings';
export const maxDuration=60;
export async function GET(){try{await requireUser('admin');return NextResponse.json(await mailStatus(),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}
export async function POST(req:NextRequest){try{sameOrigin(req);const user=await requireUser('admin');await rateLimit(req,'mail-test',3);const {id}=z.object({id:z.uuid()}).parse(await req.json());return NextResponse.json(await sendMailTest(user.id,id),{headers:{'Cache-Control':'no-store'}});}catch(error){return errorResponse(error);}}

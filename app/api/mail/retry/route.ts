import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser,sameOrigin,errorResponse,rateLimit} from '@/lib/auth';
import {setupMailRecovery} from '@/lib/mail-scheduler';
import {startMailRetryCheck} from '@/lib/mail-retry-check';
export const maxDuration=30;
export async function POST(req:NextRequest){try{
  sameOrigin(req);const user=await requireUser('admin');await rateLimit(req,'mail-retry-check',3);
  const input=z.discriminatedUnion('action',[z.object({action:z.literal('setup')}),z.object({action:z.literal('test'),id:z.uuid()})]).parse(await req.json());
  return NextResponse.json(input.action==='setup'?await setupMailRecovery():await startMailRetryCheck(user.id,input.id),{headers:{'Cache-Control':'no-store'}});
}catch(error){return errorResponse(error);}}

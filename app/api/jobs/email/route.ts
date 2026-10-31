import { NextRequest,NextResponse } from 'next/server';
import { hash,errorResponse } from '@/lib/auth';
import { ready } from '@/lib/db';
import { processMailJobs } from '@/lib/mail';
import {z} from 'zod';
import {processMailRetryCheck} from '@/lib/mail-retry-check';
import {saveSchedulerState} from '@/lib/mail-scheduler';
export const maxDuration=60;
async function execute(req:NextRequest){try{
  if(!process.env.CRON_SECRET||hash(req.headers.get('authorization')||'')!==hash(`Bearer ${process.env.CRON_SECRET}`))return NextResponse.json({error:'Unauthorized'},{status:401});
  await ready();
  const raw=req.method==='POST'?await req.text():'';if(raw.length>1024)return NextResponse.json({error:'Invalid job payload'},{status:400});
  const input=z.object({retryTestId:z.uuid().optional()}).strict().parse(raw?JSON.parse(raw):{});
  if(input.retryTestId){const result=await processMailRetryCheck(input.retryTestId);return NextResponse.json(result.body,{status:result.status,headers:{...(result.retryAfter?{'Retry-After':String(result.retryAfter)}:{}),'Cache-Control':'no-store'}});}
  const results=await processMailJobs(1);await saveSchedulerState('mail-last-sweep',{at:Date.now(),processed:results.length});return NextResponse.json({results},{headers:{'Cache-Control':'no-store'}});
}catch(e){return errorResponse(e);}}
export const GET=execute;export const POST=execute;

import { NextRequest,NextResponse } from 'next/server';
import { hash,errorResponse } from '@/lib/auth';
import { ready } from '@/lib/db';
import { processMailJobs } from '@/lib/mail';
export const maxDuration=60;
async function execute(req:NextRequest){try{
  if(!process.env.CRON_SECRET||hash(req.headers.get('authorization')||'')!==hash(`Bearer ${process.env.CRON_SECRET}`))return NextResponse.json({error:'Unauthorized'},{status:401});
  await ready();return NextResponse.json({results:await processMailJobs(1)});
}catch(e){return errorResponse(e);}}
export const GET=execute;export const POST=execute;

import { NextResponse } from 'next/server';
import { requireUser,errorResponse } from '@/lib/auth';
import { bootstrap } from '@/lib/service';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await bootstrap(await requireUser()),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return errorResponse(e);}}

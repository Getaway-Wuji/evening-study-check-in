import { NextRequest,NextResponse } from 'next/server';
import { handleUpload,type HandleUploadBody } from '@vercel/blob/client';
import { one,settings } from '@/lib/db';
import { requireUser,sameOrigin,errorResponse } from '@/lib/auth';
import { MAX_FILE } from '@/lib/files';
import {uploadLimits,validateUploadMetadata} from '@/lib/class-policy';
export async function POST(req:NextRequest){try{
  const body=await req.json() as HandleUploadBody;
  const result=await handleUpload({body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{
    sameOrigin(req);const user=await requireUser('student'),{id}=JSON.parse(clientPayload||'{}');
    const file=await one('SELECT * FROM files WHERE id=? AND user_id=? AND ready=0',[id,user.id]);
    if(!file||file.pathname!==pathname||Date.now()-file.created_at>600000)throw new Error('上传许可无效或过期');
    const policy=(await settings()).policy,limits=uploadLimits(policy,file.purpose as 'photo'|'proof');
    validateUploadMetadata(file as {size:number;content_type:string;purpose:'photo'|'proof'},policy);
    return {allowedContentTypes:[file.content_type],maximumSizeInBytes:Math.min(MAX_FILE,limits.maxMB*1024*1024),validUntil:Date.now()+300000,addRandomSuffix:false,allowOverwrite:false};
  }});return NextResponse.json(result);
}catch(e){return errorResponse(e);}}

import { NextRequest,NextResponse } from 'next/server';
import { handleUpload,type HandleUploadBody } from '@vercel/blob/client';
import { one } from '@/lib/db';
import { requireUser,sameOrigin,errorResponse } from '@/lib/auth';
import { MAX_FILE } from '@/lib/files';
export async function POST(req:NextRequest){try{
  const body=await req.json() as HandleUploadBody;
  const result=await handleUpload({body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{
    sameOrigin(req);const user=await requireUser('student'),{id}=JSON.parse(clientPayload||'{}');
    const file=await one('SELECT * FROM files WHERE id=? AND user_id=? AND ready=0',[id,user.id]);
    if(!file||file.pathname!==pathname||Date.now()-file.created_at>600000)throw new Error('上传许可无效或过期');
    return {allowedContentTypes:[file.content_type],maximumSizeInBytes:MAX_FILE,validUntil:Date.now()+300000,addRandomSuffix:false,allowOverwrite:false};
  }});return NextResponse.json(result);
}catch(e){return errorResponse(e);}}

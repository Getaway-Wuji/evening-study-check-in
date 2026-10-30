import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser,sameOrigin,errorResponse,rateLimit } from '@/lib/auth';
import { run,settings } from '@/lib/db';
import {uploadLimits,validateUploadMetadata} from '@/lib/class-policy';
import { MAX_FILE,checkFile,localPath } from '@/lib/files';
import { mkdir,writeFile } from 'node:fs/promises';
export const runtime='nodejs';
export async function POST(req:NextRequest){try{
  sameOrigin(req);const user=await requireUser('student');await rateLimit(req,'files:'+user.id,30);
  const policy=(await settings()).policy;
  if(req.headers.get('content-type')?.includes('multipart/form-data')){
    if(process.env.VERCEL||process.env.BLOB_READ_WRITE_TOKEN)throw new Error('请通过安全直传入口上传文件');
    if(Number(req.headers.get('content-length')||0)>MAX_FILE+20000)throw new Error('文件过大');
    const fd=await req.formData(),f=fd.get('file'),purpose=z.enum(['photo','proof']).parse(fd.get('purpose'));
    if(!(f instanceof File))throw new Error('请选择要上传的文件');
    validateUploadMetadata({size:f.size,content_type:f.type,purpose},policy);
    const bytes=new Uint8Array(await f.arrayBuffer());checkFile(bytes,f.type,purpose,uploadLimits(policy,purpose));
    const id=crypto.randomUUID();await mkdir('data/uploads',{recursive:true});await writeFile(localPath(id),bytes);
    await run('INSERT INTO files(id,user_id,name,content_type,size,pathname,ready,purpose,created_at) VALUES(?,?,?,?,?,?,1,?,?)',[id,user.id,f.name.slice(0,120),f.type,f.size,id,purpose,Date.now()]);
    return NextResponse.json({id,name:f.name});
  }
  const input=z.object({name:z.string().min(1).max(120),size:z.number().positive().max(MAX_FILE),contentType:z.enum(['image/jpeg','image/png','application/pdf']),purpose:z.enum(['photo','proof'])}).parse(await req.json());
  validateUploadMetadata({size:input.size,content_type:input.contentType,purpose:input.purpose},policy);
  if(!process.env.BLOB_READ_WRITE_TOKEN){if(process.env.VERCEL)throw new Error('管理员尚未配置私有文件存储');return NextResponse.json({local:true});}
  if(input.purpose==='photo'&&input.contentType==='application/pdf')throw new Error('打卡照片必须为图片');
  const id=crypto.randomUUID(),pathname=`study/${user.id}/${id}.${input.contentType==='application/pdf'?'pdf':input.contentType==='image/png'?'png':'jpg'}`;
  await run('INSERT INTO files(id,user_id,name,content_type,size,pathname,purpose,created_at) VALUES(?,?,?,?,?,?,?,?)',[id,user.id,input.name,input.contentType,input.size,pathname,input.purpose,Date.now()]);
  return NextResponse.json({id,pathname});
}catch(e){return errorResponse(e);}}

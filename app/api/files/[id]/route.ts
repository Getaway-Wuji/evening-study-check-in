import { NextRequest,NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { requireUser,sameOrigin,errorResponse,HTTPError } from '@/lib/auth';
import { one,audit } from '@/lib/db';
import { localPath,validateRemote } from '@/lib/files';
async function accessible(id:string){
  const user=await requireUser(),file=await one('SELECT * FROM files WHERE id=?',[id]);
  if(!file||(user.role!=='admin'&&file.user_id!==user.id))throw new HTTPError(404,'文件不存在或无权查看');
  return {user,file};
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
  sameOrigin(req);const {id}=await params,{file,user}=await accessible(id);
  if(file.user_id!==user.id)throw new HTTPError(403,'无法确认他人的上传');
  if(!file.ready)await validateRemote(file);
  return NextResponse.json({id:file.id,name:file.name});
}catch(e){return errorResponse(e);}}
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params,{file,user}=await accessible(id);
  if(!file.ready)throw new Error('文件未就绪');
  if(user.role==='admin')await audit(user.id,'查看证明或照片',{file:id,owner:file.user_id});
  let body:BodyInit;
  if(file.url){const result=await get(file.pathname,{access:'private'});if(!result||result.statusCode!==200)throw new Error('文件暂时无法读取');body=result.stream;}
  else {if(process.env.VERCEL)throw new Error('文件存储未配置');body=new Uint8Array(await readFile(localPath(id)));}
  return new NextResponse(body,{headers:{'Content-Type':file.content_type,'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`${file.content_type==='application/pdf'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`}});
}catch(e){return errorResponse(e);}}

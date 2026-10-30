import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { get } from '@vercel/blob';
import { one,run,audit,settings,type DBRow } from './db';
import {defaultClassPolicy,uploadLimits,validateUploadMetadata} from './class-policy';
export const MAX_FILE=10*1024*1024;
export function checkFile(bytes:Uint8Array,declared:string,purpose:string,limits=uploadLimits(defaultClassPolicy,purpose as 'photo'|'proof')){
  const b=Buffer.from(bytes),actual=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':b.subarray(0,5).toString()==='%PDF-'?'application/pdf':'';
  if(!actual||actual!==declared||(purpose==='photo'&&!actual.startsWith('image/')))throw new Error('仅接受真实的 JPG、PNG 图片或 PDF 证明，文件格式与内容必须一致');
  if(!b.length||b.length>Math.min(MAX_FILE,limits.maxMB*1024*1024))throw new Error(`每个文件不得超过 ${limits.maxMB} MB`);
  if(!limits.allowedTypes.includes(actual))throw new Error('本班当前未启用此文件格式');
}
export function localPath(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('文件编号无效');return path.resolve('data/uploads',id);}
export async function validateRemote(file:DBRow){
  const policy=(await settings()).policy,limits=uploadLimits(policy,file.purpose as 'photo'|'proof');
  const result=await get(file.pathname,{access:'private',useCache:false});
  if(!result||result.statusCode!==200)throw new Error('文件尚未上传完成，请重试');
  validateUploadMetadata({size:result.blob.size,content_type:file.content_type,purpose:file.purpose},policy);
  const bytes=new Uint8Array(await new Response(result.stream).arrayBuffer());checkFile(bytes,file.content_type,file.purpose,limits);
  await run('UPDATE files SET ready=1,url=?,size=? WHERE id=?',[result.blob.url,bytes.length,file.id]);
}

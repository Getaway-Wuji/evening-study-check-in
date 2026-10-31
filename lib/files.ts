import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { get,put,del } from '@vercel/blob';
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
export async function readPrivateProof(file:DBRow){
  if(!file.ready||file.purpose!=='proof'||file.size<=0||file.size>MAX_FILE)throw new Error('证明材料未就绪或大小不符');
  let bytes:Uint8Array;
  if(file.url){
    const result=await get(file.pathname,{access:'private',useCache:false,abortSignal:AbortSignal.timeout(15000)});
    if(!result||result.statusCode!==200||result.blob.size>MAX_FILE)throw new Error('证明材料暂时无法读取，请重试邮件');
    bytes=new Uint8Array(await new Response(result.stream).arrayBuffer());
  }else{if(process.env.VERCEL)throw new Error('证明材料未连接正式文件存储');bytes=new Uint8Array(await readFile(localPath(file.id)));}
  if(bytes.length!==Number(file.size))throw new Error('证明材料大小已改变，请核对原件');
  checkFile(bytes,file.content_type,'proof',{maxFiles:1,maxMB:10,allowedTypes:['image/jpeg','image/png','application/pdf']});
  return Buffer.from(bytes);
}
export async function testPrivateProof(id:string,bytes:Buffer){
  if(!process.env.BLOB_READ_WRITE_TOKEN)return {bytes,privateStorageChecked:false};
  const blob=await put(`email-tests/${id}.png`,bytes,{access:'private',contentType:'image/png',addRandomSuffix:true,abortSignal:AbortSignal.timeout(15000)});
  try{
    const loaded=await readPrivateProof({id,ready:1,purpose:'proof',size:bytes.length,content_type:'image/png',pathname:blob.pathname,url:blob.url});
    if(!loaded.equals(bytes))throw new Error('测试证明图片读取结果不一致');
    return {bytes:loaded,privateStorageChecked:true};
  }finally{await del(blob.url).catch(()=>{console.error('Synthetic mail test object cleanup failed');});}
}
export async function validateRemote(file:DBRow){
  const policy=(await settings()).policy,limits=uploadLimits(policy,file.purpose as 'photo'|'proof');
  const result=await get(file.pathname,{access:'private',useCache:false});
  if(!result||result.statusCode!==200)throw new Error('文件尚未上传完成，请重试');
  validateUploadMetadata({size:result.blob.size,content_type:file.content_type,purpose:file.purpose},policy);
  const bytes=new Uint8Array(await new Response(result.stream).arrayBuffer());checkFile(bytes,file.content_type,file.purpose,limits);
  await run('UPDATE files SET ready=1,url=?,size=? WHERE id=?',[result.blob.url,bytes.length,file.id]);
}

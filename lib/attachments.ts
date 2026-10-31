import {one,settings,type Connection} from './db';
import {uploadLimits,validateUploadMetadata} from './class-policy';
export async function attachments(ids:string[],purpose:string,userId:string,c:Connection){
  const policy=(await settings(c)).policy,kind=purpose as 'photo'|'proof',limits=uploadLimits(policy,kind);
  if(ids.length>limits.maxFiles)throw new Error(`本班最多提交 ${limits.maxFiles} 个${purpose==='photo'?'照片':'证明'}文件`);
  if(new Set(ids).size!==ids.length)throw new Error('附件不能重复选择');
  for(const id of ids){
    const file=await one('SELECT * FROM files WHERE id=? AND user_id=? AND purpose=? AND ready=1',[id,userId,purpose],c);
    if(!file)throw new Error('附件尚未上传完成或无权使用');
    validateUploadMetadata(file as {size:number;content_type:string;purpose:'photo'|'proof'},policy);
  }
}

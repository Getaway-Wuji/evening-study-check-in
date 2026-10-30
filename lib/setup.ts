import { z } from 'zod';
import { ready,one,run,transaction,audit,settings } from './db';
import { passwordHash,HTTPError } from './auth';
export async function needsSetup(){await ready();return !await one("SELECT id FROM users WHERE role='admin' LIMIT 1");}
export function localSetupAllowed(){
  if(process.env.VERCEL||process.env.NODE_ENV==='production')return false;
  try{return ['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.APP_URL||'http://127.0.0.1:3000').hostname);}catch{return false;}
}
export async function initializeClass(raw:unknown){
  const input=z.object({className:z.string().trim().min(1).max(40),username:z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),password:z.string().min(14).max(128)}).parse(raw);
  const pw=await passwordHash(input.password);
  return transaction(async tx=>{
    if(await one("SELECT id FROM users WHERE role='admin' LIMIT 1",[],tx))throw new HTTPError(409,'系统已完成初始化，请直接登录');
    const id=crypto.randomUUID();await run("INSERT INTO users(id,code,name,role,password_hash,created_at) VALUES(?,?,?,'admin',?,?)",[id,input.username,'班级管理员',pw,Date.now()],tx);
    const config=await settings(tx);await run('UPDATE settings SET value=? WHERE id=1',[JSON.stringify({...config,className:input.className,capacity:39,locationConfigured:false})],tx);
    await audit(id,'初始化真实班级',{className:input.className},tx);return {id};
  });
}

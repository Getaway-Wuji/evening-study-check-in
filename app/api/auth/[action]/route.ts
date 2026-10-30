import { NextRequest,NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ready,one,run,transaction,demoMode,audit } from '@/lib/db';
import { hash,passwordHash,passwordMatches,signIn,sameOrigin,errorResponse,rateLimit,token,requireUser } from '@/lib/auth';
import { normalizeStudentCode,normalizeStudentName } from '@/lib/identity';
export const runtime='nodejs';
export async function POST(req:NextRequest,{params}:{params:Promise<{action:string}>}){
  try{
    sameOrigin(req);await ready();const {action}=await params;
    await rateLimit(req,action,action==='demo'?30:200);
    if(action==='logout'){
      const value=(await cookies()).get('study_session')?.value;
      if(value)await run('DELETE FROM auth_sessions WHERE token_hash=?',[hash(value)]);
      const res=NextResponse.json({next:'/login'});res.cookies.delete('study_session');return res;
    }
    if(action==='demo'){
      if(!demoMode())return NextResponse.json({error:'演示入口未开启'},{status:404});
      const {role}=z.object({role:z.enum(['student','admin'])}).parse(await req.json());
      const u=await one('SELECT id FROM users WHERE code=?',[role==='admin'?'demo-admin':'202601']);
      if(!u)throw new Error('请先初始化本地演示数据');
      return signIn(u.id,NextResponse.json({next:role==='admin'?'/admin':'/student'}));
    }
    if(action==='login'){
      const input=z.object({code:z.string().trim().min(1).max(40),password:z.string().min(1).max(128)}).parse(await req.json());
      await rateLimit(req,'login-account:'+input.code,12);
      const u=await one('SELECT * FROM users WHERE code=? AND active=1',[input.code]);
      if(!await passwordMatches(input.password,u?.password_hash??null))throw new Error('账号或密码不正确');
      await audit(u.id,'账号登录',{});
      return signIn(u.id,NextResponse.json({next:u.role==='admin'?'/admin':'/student'}));
    }
    if(action==='password'){
      const user=await requireUser();
      const input=z.object({currentPassword:z.string().max(128).optional(),password:z.string().min(10).max(128)}).parse(await req.json());
      const u=await one('SELECT password_hash FROM users WHERE id=?',[user.id]);
      if(u.password_hash&&!await passwordMatches(input.currentPassword||'',u.password_hash))throw new Error('当前密码不正确');
      const value=await passwordHash(input.password),current=(await cookies()).get('study_session')?.value;
      await transaction(async tx=>{await run('UPDATE users SET password_hash=? WHERE id=?',[value,user.id],tx);await run('DELETE FROM auth_sessions WHERE user_id=? AND token_hash<>?',[user.id,hash(current||'')],tx);await audit(user.id,'更新登录密码',{},tx);});
      return NextResponse.json({message:'登录密码已更新，其他设备的旧登录已失效'});
    }
    if(action==='register'||action==='bind'){
      const input=z.object({code:z.string().transform(normalizeStudentCode).pipe(z.string().min(1).max(32)),name:z.string().trim().min(1).max(30),password:action==='register'?z.string().min(10).max(128):z.string().max(128).optional()}).parse(await req.json());
      await rateLimit(req,'activate:'+input.code,12);
      const pendingToken=(await cookies()).get('wechat_pending')?.value;
      const pending=action==='bind'&&pendingToken?await one('SELECT * FROM wechat_pending WHERE token_hash=? AND expires_at>?',[hash(pendingToken),Date.now()]):null;
      if(action==='bind'&&!pending)throw new Error('微信授权已过期，请从公众号重新进入');
      const pw=action==='register'?await passwordHash(input.password!):null;
      const userId=await transaction(async tx=>{
        const u=await one("SELECT * FROM users WHERE code=? AND role='student' AND active=1",[input.code],tx);
        if(!u||normalizeStudentName(u.name)!==normalizeStudentName(input.name))throw new Error('学号或姓名与班级名单不一致，请核对或联系管理员');
        if(action==='bind'&&u.password_hash){
          if(u.openid||!await passwordMatches(input.password||'',u.password_hash))throw new Error('账号密码不正确或已绑定其他微信');
          await run('UPDATE users SET openid=? WHERE id=?',[pending!.openid,u.id],tx);
        }else{
          if(u.openid||u.password_hash)throw new Error('该学号已注册，请直接登录或联系管理员重置账号');
          await run('UPDATE users SET password_hash=?,openid=? WHERE id=?',[pw,pending?.openid??null,u.id],tx);
        }
        if(pending)await run('DELETE FROM wechat_pending WHERE token_hash=?',[hash(pendingToken!)],tx);
        await audit(u.id,action==='bind'?'绑定公众号微信身份':'学生注册账号',{},tx);return u.id;
      });
      const res=NextResponse.json({next:'/student'});res.cookies.delete('wechat_pending');return signIn(userId,res);
    }
    return NextResponse.json({error:'未知登录操作'},{status:404});
  }catch(e){return errorResponse(e);}
}

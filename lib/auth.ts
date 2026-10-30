import { randomBytes, scrypt as scryptCB, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { ready, one, run, db, transaction, type DBRow } from './db';
const scrypt = promisify(scryptCB);
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export async function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return salt+':'+(await scrypt(password,salt,64) as Buffer).toString('hex'); }
export async function passwordMatches(password: string, stored: string | null) {
  if (!stored) { await scrypt(password,'invalid-account',64); return false; }
  const [salt,h] = stored.split(':');
  if (!salt || !h) return false;
  const a = await scrypt(password,salt,64) as Buffer, b = Buffer.from(h,'hex');
  return a.length === b.length && timingSafeEqual(a,b);
}
export async function currentUser(): Promise<DBRow | undefined> {
  const t = (await cookies()).get('study_session')?.value;
  if (!t) return;
  await ready();
  return one('SELECT u.id,u.code,u.name,u.role,u.active,CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END hasPassword,CASE WHEN u.openid IS NOT NULL THEN 1 ELSE 0 END hasWechat FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',[hash(t),Date.now()]);
}
export async function requireUser(role?: 'student'|'admin') {
  const user=await currentUser();
  if (!user) throw new HTTPError(401,'请先登录');
  if (role && user.role !== role) throw new HTTPError(403,'没有执行此操作的权限');
  return user;
}
export async function signIn(userId: string, response: NextResponse) {
  const t=token();
  await run('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',[hash(t),userId,Date.now()+7*86400000]);
  response.cookies.set('study_session',t,{ httpOnly: true, secure: process.env.NODE_ENV==='production', sameSite: 'lax', path: '/', maxAge: 7*86400 });
  return response;
}
export class HTTPError extends Error { constructor(public status: number,message: string) { super(message); } }
export function sameOrigin(req: NextRequest) {
  const origin=req.headers.get('origin');
  const allowed=new Set([req.nextUrl.origin,...(process.env.APP_URL?[new URL(process.env.APP_URL).origin]:[])]);
  if (!origin || !allowed.has(origin)) throw new HTTPError(403,'请求来源验证失败，请刷新后重试');
}
export async function rateLimit(req: NextRequest, scope: string, max=15) {
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const key=hash(scope+':'+ip), now=Date.now();
  const result=await transaction(tx=>tx.execute({sql:`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`,args:[key,now+600000,now,now]}));
  if (Number(result.rows[0].count)>max) throw new HTTPError(429,'操作过于频繁，请稍后再试');
}
export function errorResponse(error: unknown) {
  if (error instanceof HTTPError) return NextResponse.json({error:error.message},{status:error.status});
  if (error && typeof error==='object' && 'issues' in error) return NextResponse.json({error:'填写内容不正确，请检查必填项、格式和长度'},{status:400});
  const message=error instanceof Error?error.message:'';
  if (/UNIQUE constraint/.test(message)) return NextResponse.json({error:'已有重复记录，请刷新后查看'},{status:409});
  if (/LIBSQL|SQLITE|database|fetch failed|ENOENT|DATABASE_URL/i.test(message)) {
    console.error('Storage operation failed:',message.replace(/(libsql|https):\/\/\S+/g,'[database]'));
    return NextResponse.json({error:'数据服务暂时不可用，请稍后重试'},{status:503});
  }
  return NextResponse.json({error:message || '操作失败，请稍后重试'},{status:400});
}

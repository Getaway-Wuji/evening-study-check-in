import { createClient, type Client, type Transaction, type InValue } from '@libsql/client';
import { defaultRules } from './domain';
import { mkdirSync } from 'node:fs';
export type Connection = Client | Transaction;
export type DBRow = Record<string, any>;
const globalDB = globalThis as unknown as { studyDB?: Client; schemaReady?: Promise<void>; schemaVersion?:number; writeTail?:Promise<void> };
export function db() {
  if (!globalDB.studyDB) {
    const url = process.env.DATABASE_URL || 'file:./data/study.db';
    if (process.env.VERCEL && !/^(libsql|https):/.test(url)) throw new Error('Vercel 需要配置远程 DATABASE_URL');
    if (url.startsWith('file:')) mkdirSync('data', { recursive: true });
    globalDB.studyDB = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  }
  return globalDB.studyDB;
}
export async function rows<T = DBRow>(sql: string, args: InValue[] = [], c: Connection = db()): Promise<T[]> {
  return (await c.execute({ sql, args })).rows as unknown as T[];
}
export async function one<T = DBRow>(sql: string, args: InValue[] = [], c: Connection = db()) { return (await rows<T>(sql,args,c))[0]; }
export async function run(sql: string, args: InValue[] = [], c: Connection = db()) { return c.execute({ sql,args }); }
export async function transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  // 单进程写入排队；跨 Vercel 实例由数据库事务与唯一约束共同保护。
  const previous=globalDB.writeTail||Promise.resolve();let release!:()=>void;
  globalDB.writeTail=new Promise<void>(r=>{release=r;});await previous.catch(()=>{});
  try{
    for(let attempt=0;;attempt++){
      let tx:Transaction|undefined;
      try{tx=await db().transaction('write');const result=await fn(tx);await tx.commit();return result;}
      catch(e){
        if(tx&&!tx.closed)await tx.rollback();
        const code=(e as {code?:string}).code;
        if(attempt>=5||!['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'].includes(code||''))throw e;
        await new Promise(r=>setTimeout(r,30*(attempt+1)));
      }finally{tx?.close();}
    }
  }finally{release();}
}
export async function ready() {
  if(globalDB.schemaVersion!==2){globalDB.schemaReady=undefined;globalDB.schemaVersion=2;}
  if (!globalDB.schemaReady) globalDB.schemaReady = migrate().catch(e=>{ globalDB.schemaReady=undefined; throw e; });
  await globalDB.schemaReady;
}
async function migrate() {
  if((process.env.DATABASE_URL||'file:').startsWith('file:'))await db().executeMultiple('PRAGMA journal_mode=WAL;');
  await db().executeMultiple(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','admin')), password_hash TEXT, openid TEXT UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wechat_pending (token_hash TEXT PRIMARY KEY, openid TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS integration_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS defaults_versions (id TEXT PRIMARY KEY, effective_from TEXT NOT NULL, rules_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, rules_json TEXT NOT NULL, is_override INTEGER NOT NULL DEFAULT 0, cancelled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, reason TEXT NOT NULL DEFAULT '', term_id TEXT, recurrence_id TEXT, week_number INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS academic_terms (id TEXT PRIMARY KEY,name TEXT NOT NULL,first_monday TEXT NOT NULL,total_weeks INTEGER NOT NULL,weekdays_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,published_revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recurring_rules (id TEXT PRIMARY KEY,term_id TEXT NOT NULL REFERENCES academic_terms(id),weekday INTEGER NOT NULL,start_week INTEGER NOT NULL,end_week INTEGER NOT NULL,rules_json TEXT NOT NULL,inherit_time INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS session_members (session_id TEXT NOT NULL REFERENCES sessions(id), user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(session_id,user_id));
    CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), user_id TEXT NOT NULL REFERENCES users(id), submitted_at INTEGER NOT NULL, latitude REAL, longitude REAL, accuracy REAL, distance REAL, captured_at INTEGER, source_coords TEXT, photo_ids TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', rule_snapshot TEXT NOT NULL, rule_version INTEGER NOT NULL, UNIQUE(session_id,user_id));
    CREATE TABLE IF NOT EXISTS leaves (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, reason TEXT NOT NULL, proof_ids TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS leave_items (id TEXT PRIMARY KEY, leave_id TEXT NOT NULL REFERENCES leaves(id), user_id TEXT NOT NULL REFERENCES users(id), session_id TEXT NOT NULL REFERENCES sessions(id), status TEXT NOT NULL, review_note TEXT, reviewer_id TEXT, reviewed_at INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_leave ON leave_items(user_id,session_id) WHERE status IN ('pending','approved');
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, pathname TEXT NOT NULL, url TEXT, ready INTEGER NOT NULL DEFAULT 0, purpose TEXT NOT NULL CHECK(purpose IN ('photo','proof')), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS email_jobs (id TEXT PRIMARY KEY, leave_id TEXT NOT NULL UNIQUE REFERENCES leaves(id), status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, lease_until INTEGER, provider_id TEXT, error TEXT, payload_json TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_email_due ON email_jobs(status,next_attempt);
  `);
  const columns=await rows('PRAGMA table_info(sessions)');
  for(const [name,type] of [['term_id','TEXT'],['recurrence_id','TEXT'],['week_number','INTEGER']]){
    if(!columns.some(c=>c.name===name))await run(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
  }
  await run('INSERT OR IGNORE INTO settings(id,value) VALUES(1,?)',[JSON.stringify({ className: '我的班级', capacity: 39, adminEmails: [], locationConfigured: false })]);
  await run('INSERT OR IGNORE INTO defaults_versions(id,effective_from,rules_json,created_at) VALUES(?,?,?,?)',['initial','2000-01-01',JSON.stringify(defaultRules),Date.now()]);
}
export async function settings(c: Connection = db()) { return JSON.parse((await one('SELECT value FROM settings WHERE id=1',[],c)).value); }
export async function rulesFor(date: string,c: Connection = db()) {
  return JSON.parse((await one('SELECT rules_json FROM defaults_versions WHERE effective_from<=? ORDER BY effective_from DESC,created_at DESC LIMIT 1',[date],c)).rules_json);
}
export async function audit(userId: string, action: string, detail: unknown,c: Connection = db()) {
  await run('INSERT INTO audit_logs(id,user_id,action,detail,created_at) VALUES(?,?,?,?,?)',[crypto.randomUUID(),userId,action,JSON.stringify(detail),Date.now()],c);
}
export function demoMode() { return !process.env.VERCEL && process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true'; }
export function businessNow() {
  if (!demoMode()) return Date.now();
  const d = new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  return Date.parse(`${d}T17:45:00+08:00`);
}

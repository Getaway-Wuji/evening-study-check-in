export function databaseConfig(env:Record<string,string|undefined>=process.env){
  const url=env.DATABASE_URL||env.TURSO_DATABASE_URL||'file:./data/study.db';
  if(env.VERCEL&&!/^(libsql|https):/.test(url))throw new Error('Vercel 需要配置远程 DATABASE_URL 或 TURSO_DATABASE_URL');
  return {url,authToken:env.DATABASE_AUTH_TOKEN||env.TURSO_AUTH_TOKEN||undefined};
}

import {createHash} from 'node:crypto';
import {one,run} from './db';
export function schedulerConfigured(){return !!(process.env.QSTASH_TOKEN&&process.env.CRON_SECRET);}
function schedulerBase(){
  const url=new URL(process.env.QSTASH_URL||'https://qstash.upstash.io');
  if(url.protocol!=='https:'||!/^qstash(?:-[a-z0-9-]+)?\.upstash\.io$/.test(url.hostname)||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('请填写 Upstash 提供的 QSTASH_URL');
  return url.origin;
}
function destination(){const url=new URL(process.env.APP_URL||'');if(url.protocol!=='https:')throw new Error('自动调度要求正式 HTTPS APP_URL');return url.origin+'/api/jobs/email';}
async function publish(path:'publish'|'schedules',body:object,extra:Record<string,string>={}){
  if(!schedulerConfigured())throw new Error('请先配置自动调度连接凭据');
  const response=await fetch(`${schedulerBase()}/v2/${path}/${destination()}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.QSTASH_TOKEN}`,'Content-Type':'application/json','Upstash-Forward-Authorization':`Bearer ${process.env.CRON_SECRET}`,'Upstash-Method':'POST','Upstash-Timeout':'55s','Upstash-Retries':'3','Upstash-Retry-Delay':'10000 * pow(2, retried)','Upstash-Redact-Fields':'header[Authorization]','Upstash-Label':'study-mail',...extra},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw new Error(`调度服务暂时未接收任务（${response.status}）`);
  return response.json();
}
export async function publishMailWake(delay=0,retryTestId?:string){
  const result=await publish('publish',retryTestId?{retryTestId}:{},{...(delay?{'Upstash-Delay':`${Math.max(1,Math.ceil(delay))}s`}:{}),...(retryTestId?{'Upstash-Deduplication-Id':`study-mail-test-${retryTestId}`}:{})});
  if(typeof result.messageId!=='string')throw new Error('调度服务未返回任务编号');
  return result.messageId as string;
}
export async function setupMailRecovery(){
  const cron=process.env.MAIL_SWEEP_CRON||'*/5 * * * *',scheduleId='study-mail-'+createHash('sha256').update(destination()).digest('hex').slice(0,16);
  const result=await publish('schedules',{}, {'Upstash-Cron':cron,'Upstash-Schedule-Id':scheduleId,'Upstash-Retries':'1','Upstash-Label':'study-mail-recovery'});
  if(typeof result.scheduleId!=='string')throw new Error('调度服务未返回定时任务编号');
  await saveSchedulerState('mail-recovery',{scheduleId:result.scheduleId,cron,configuredAt:Date.now()});
  return {scheduleId:result.scheduleId,cron,message:'定时检查已建立，将自动补捞到期未发送的通知。'};
}
export async function saveSchedulerState(key:string,value:object){await run('INSERT INTO integration_cache(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at',[key,JSON.stringify(value),Date.now()+365*86400000]);}
export async function readSchedulerState(key:string){const row=await one('SELECT value FROM integration_cache WHERE key=?',[key]);return row?JSON.parse(row.value):null;}

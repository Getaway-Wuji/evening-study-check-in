import {z} from 'zod';
import {HTTPError} from './auth';
import {rows,settings,businessNow,type DBRow} from './db';
import {dateCN,period,type Rules} from './domain';
import {assessFence,validFence} from './geofence';

export interface LocationTestTarget {id:string;date:string;rules:Rules}
export interface LocationTestContext {enabled:boolean;available:boolean;reason:string;targets:LocationTestTarget[];now:number}
const inputSchema=z.object({sessionId:z.string().min(1),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().positive(),capturedAt:z.number(),coordinateSystem:z.enum(['wgs84','gcj02'])});

export async function locationTestContext(user:DBRow,now=businessNow()):Promise<LocationTestContext>{
  if(user.role!=='student')throw new HTTPError(403,'此入口仅供学生测试定位');
  const config=await settings(),enabled=config.policy.locationTest.enabled;
  if(!enabled)return {enabled:false,available:false,reason:'管理员暂未开放定位测试',targets:[],now};
  const sessions=(await rows('SELECT s.id,s.date,s.rules_json FROM sessions s JOIN session_members m ON m.session_id=s.id WHERE m.user_id=? AND s.cancelled=0',[user.id])).map(s=>({id:String(s.id),date:String(s.date),rules:JSON.parse(s.rules_json) as Rules}));
  const today=dateCN(now),open=sessions.some(s=>period(s.date,s.rules,now)==='open'),seen=new Set<string>();
  // Prefer today's/next published rules over old occurrences of the same classroom.
  sessions.sort((a,b)=>{const af=a.date>=today,bf=b.date>=today;return af!==bf?(af?-1:1):af?a.date.localeCompare(b.date):b.date.localeCompare(a.date);});
  const targets=sessions.filter(s=>{
    const r=s.rules;if(!r.locationRequired||!validFence(r)||!r.locationConfirmed&&!config.locationConfigured)return false;
    const key=JSON.stringify([r.locationName,r.latitude,r.longitude,r.radius,r.accuracyLimit,r.locationMaxAge]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
  const reason=open?'当前是正式打卡时段，请使用正常打卡入口':!targets.length?'暂无已发布并核对的定位教室，请联系管理员完善打卡安排':'';
  return {enabled:true,available:!reason,reason,targets,now};
}

export async function testStudentLocation(user:DBRow,raw:unknown,now=businessNow()){
  const input=inputSchema.parse(raw),context=await locationTestContext(user,now);
  if(!context.enabled)throw new HTTPError(403,context.reason);
  if(!context.available)throw new HTTPError(409,context.reason);
  const target=context.targets.find(t=>t.id===input.sessionId);
  if(!target)throw new HTTPError(403,'测试教室已更新或不适用于你，请刷新后重新选择');
  const assessment=assessFence(target.rules,input,now);
  // Deliberately read-only: never insert checkins, applications, files, mail jobs, or location logs.
  return {eligible:assessment.eligible,inside:assessment.inside,distance:Math.round(assessment.distance*10)/10,accuracy:input.accuracy,capturedAt:input.capturedAt,testedAt:now,message:assessment.message,target,recorded:false as const};
}
export type LocationTestResult=Awaited<ReturnType<typeof testStudentLocation>>;

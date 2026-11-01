import type {LocationDiagnostic,LocationStrategy} from './location';
export function preferredLocationStrategy(userAgent:string):LocationStrategy{return /HarmonyOS|OpenHarmony|ArkWeb|Huawei|HMSCore/i.test(userAgent)?'compatible':'standard';}
export function locationReport(input:{userAgent:string;strategy:LocationStrategy;elapsedMs:number;status:string;permission:string;events:LocationDiagnostic[]}){
  return JSON.stringify({engine:'location-v3',browser:input.userAgent.slice(0,500),strategy:input.strategy,elapsedMs:Math.round(input.elapsedMs),status:input.status,permission:input.permission,
    events:input.events.slice(-24).map(e=>({method:e.method,outcome:e.outcome,elapsedMs:Math.round(e.elapsedMs),...(e.code===undefined?{}:{code:e.code}),...(e.accuracy===undefined?{}:{accuracy:e.accuracy})}))},null,2);
}

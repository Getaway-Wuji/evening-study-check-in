import {browserPosition} from './browser-position';

// Field evidence: some ArkWeb hosts return valid coordinates/accuracy with a
// constant timestamp of 10000. A cached result can never use this workaround.
// For a new maximumAge:0 request, use its START as a conservative age boundary,
// retain the broken device value, and label the alternate basis end-to-end.
export function harmonyPosition(value:unknown,maxAgeMs:number,request:{enabled:boolean;maximumAge:number;startedAt:number},now=Date.now()){
  const parsed=browserPosition(value,maxAgeMs,now);
  if(parsed.position||!request.enabled||request.maximumAge!==0||parsed.sample.issue!=='stale-timestamp'||parsed.sample.timestampValue!==10000)return parsed;
  const elapsed=now-request.startedAt;
  if(!Number.isFinite(request.startedAt)||request.startedAt<=0||elapsed<0||elapsed>maxAgeMs)return parsed;
  try{
    const fresh=browserPosition({timestamp:request.startedAt,coords:(value as {coords:unknown}).coords},maxAgeMs,now);
    if(!fresh.position)return parsed;
    return {position:{...fresh.position,timeBasis:'fresh-request' as const,deviceTimestamp:10000},sample:{...parsed.sample,timeBasis:'fresh-request' as const,effectiveAgeMs:Math.round(elapsed)}};
  }catch{return parsed;}
}

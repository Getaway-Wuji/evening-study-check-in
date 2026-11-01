export interface StudyLocation {latitude:number;longitude:number;accuracy:number;capturedAt:number;coordinateSystem:'wgs84'|'gcj02';timeBasis?:'fresh-request';deviceTimestamp?:number}
export class LocationFailure extends Error{constructor(message:string,public kind:'cancelled'|'permission'|'technical'){super(message);}}
export type LocationStrategy='standard'|'compatible';
export interface LocationProgress {stage:'locating'|'network'|'improving'|'wechat'|'compatible';accuracy?:number;attempt?:number}
export type LocationSampleIssue='unreadable-position'|'missing-coordinates'|'invalid-coordinates'|'invalid-accuracy'|'missing-timestamp'|'invalid-timestamp'|'stale-timestamp'|'future-timestamp';
export interface LocationSampleDiagnostic {issue?:LocationSampleIssue;coordinates?:'missing'|'invalid'|'valid';timestampType?:string;timestampValue?:number;ageMs?:number;accuracyType?:string;accuracyValue?:number;timeBasis?:'fresh-request';effectiveAgeMs?:number}
export interface LocationDiagnostic {method:'watch'|'single-high'|'single-balanced';outcome:'started'|'sample'|'error'|'timeout'|'invalid';elapsedMs:number;code?:number;accuracy?:number;sample?:LocationSampleDiagnostic}
export interface LocationOptions {signal?:AbortSignal;targetAccuracy?:number;maxAgeSeconds?:number;timeoutMs?:number;strategy?:LocationStrategy;harmonyClockWorkaround?:boolean;onProgress?:(progress:LocationProgress)=>void;onDiagnostic?:(event:LocationDiagnostic)=>void}
export function readLocation(input:{latitude:unknown;longitude:unknown;accuracy:unknown},coordinateSystem:StudyLocation['coordinateSystem'],now=Date.now()):StudyLocation{
  const numeric=(value:unknown)=>typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  const latitude=numeric(input.latitude),longitude=numeric(input.longitude),accuracy=numeric(input.accuracy);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude< -90||latitude>90||longitude< -180||longitude>180)throw new Error('定位坐标无效，请重新获取');
  if(!Number.isFinite(accuracy)||accuracy<=0)throw new Error('设备未返回有效定位精度，请重新获取');
  return {latitude,longitude,accuracy,capturedAt:now,coordinateSystem};
}
export function wechatSignatureURL(userAgent:string,currentURL:string,entryURL?:string){
  return (/iPhone|iPad|iPod/i.test(userAgent)&&entryURL?entryURL:currentURL).split('#')[0];
}

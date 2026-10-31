import {checkLocation,distanceMeters,wgsToGcj,type Rules} from './domain';
import type {StudyLocation} from './location';
export type FencePoint={latitude:number;longitude:number};
export function validFence(r:Pick<Rules,'latitude'|'longitude'|'radius'>){return Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)&&Number.isFinite(r.radius)&&Math.abs(r.latitude)<=85&&Math.abs(r.longitude)<=180&&(r.latitude!==0||r.longitude!==0)&&r.radius>=10&&r.radius<=2000;}
export function gcjToWgs(lat:number,lng:number):[number,number]{
  let a=lat,b=lng;for(let i=0;i<8;i++){const [x,y]=wgsToGcj(a,b),dx=x-lat,dy=y-lng;a-=dx;b-=dy;if(Math.abs(dx)+Math.abs(dy)<1e-9)break;}return [a,b];
}
export function fencePoint(p:StudyLocation):FencePoint{const [latitude,longitude]=p.coordinateSystem==='wgs84'?wgsToGcj(p.latitude,p.longitude):[p.latitude,p.longitude];return {latitude,longitude};}
export function fenceDistance(r:FencePoint,p:FencePoint){return distanceMeters(r.latitude,r.longitude,p.latitude,p.longitude);}
// Construct the boundary in the same GCJ-02 space and with the same Earth radius as server validation.
export function fenceRing(r:Pick<Rules,'latitude'|'longitude'|'radius'>,segments=96):[number,number][]{
  const rad=Math.PI/180,lat=r.latitude*rad,lng=r.longitude*rad,d=r.radius/6371008.8;
  return Array.from({length:segments},(_,i)=>{const b=i*2*Math.PI/segments,a=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b)),o=lng+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(a));return [a/rad,o/rad];});
}
export function assessFence(r:Rules,p:StudyLocation,now=Date.now()){
  const point=fencePoint(p),distance=fenceDistance(r,point);let message='',eligible=false;
  try{checkLocation(r,p,now);eligible=true;message='位置、精度和有效期满足当前定位规则';}catch(error){message=error instanceof Error?error.message:'当前定位不满足规则';}
  return {point,distance,inside:distance<=r.radius,eligible,message};
}
export function localMeters(center:FencePoint,p:FencePoint){
  return {east:Math.sign(p.longitude-center.longitude)*distanceMeters(center.latitude,center.longitude,center.latitude,p.longitude),north:Math.sign(p.latitude-center.latitude)*distanceMeters(center.latitude,center.longitude,p.latitude,center.longitude)};
}

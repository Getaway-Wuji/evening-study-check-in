export interface StudyLocation {latitude:number;longitude:number;accuracy:number;capturedAt:number;coordinateSystem:'wgs84'|'gcj02'}
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

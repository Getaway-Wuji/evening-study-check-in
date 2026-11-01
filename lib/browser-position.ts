import {readLocation,type StudyLocation,type LocationSampleDiagnostic,type LocationSampleIssue} from './location';

// Native bridges may serialize numbers as strings. Decode their values without
// guessing time units, replacing missing timestamps, or manufacturing accuracy.
const numeric=(value:unknown)=>typeof value==='number'?value:typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())?Number(value):NaN;
export function browserPosition(value:unknown,maxAgeMs:number,now=Date.now()):{position?:StudyLocation;sample:LocationSampleDiagnostic}{
  const sample:LocationSampleDiagnostic={};
  const invalid=(issue:LocationSampleIssue)=>({sample:{...sample,issue}});
  try{
    if(!value||typeof value!=='object')return invalid('unreadable-position');
    const input=value as {timestamp?:unknown;coords?:unknown},timestamp=numeric(input.timestamp);
    sample.timestampType=typeof input.timestamp;
    if(Number.isFinite(timestamp)){sample.timestampValue=timestamp;sample.ageMs=Math.round(now-timestamp);}
    if(!input.coords||typeof input.coords!=='object'){sample.coordinates='missing';return invalid('missing-coordinates');}
    const coords=input.coords as {latitude?:unknown;longitude?:unknown;accuracy?:unknown};
    const latitude=numeric(coords.latitude),longitude=numeric(coords.longitude),accuracy=numeric(coords.accuracy);
    sample.coordinates=Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180?'valid':'invalid';
    sample.accuracyType=typeof coords.accuracy;if(Number.isFinite(accuracy))sample.accuracyValue=accuracy;
    if(sample.coordinates!=='valid')return invalid('invalid-coordinates');
    if(!Number.isFinite(accuracy)||accuracy<=0)return invalid('invalid-accuracy');
    if(input.timestamp===undefined||input.timestamp===null)return invalid('missing-timestamp');
    if(!Number.isFinite(timestamp)||timestamp<=0)return invalid('invalid-timestamp');
    if(timestamp>now+10000)return invalid('future-timestamp');
    if(now-timestamp>maxAgeMs)return invalid('stale-timestamp');
    return {position:readLocation({latitude,longitude,accuracy},'wgs84',timestamp),sample};
  }catch{return invalid('unreadable-position');}
}
export function invalidPositionMessage(issue:LocationSampleIssue){
  const reasons:Record<LocationSampleIssue,string>={
    'unreadable-position':'返回的位置数据无法读取',
    'missing-coordinates':'返回的数据缺少坐标',
    'invalid-coordinates':'返回的坐标格式无效',
    'invalid-accuracy':'未提供有效的定位精度',
    'missing-timestamp':'未提供位置采集时间',
    'invalid-timestamp':'位置采集时间格式无效',
    'stale-timestamp':'位置采集时间已超出有效期',
    'future-timestamp':'位置采集时间晚于手机当前时间',
  };
  return `手机已返回定位数据，但${reasons[issue]}。请复制下方定位诊断交给管理员核查；时间异常时也请检查手机的自动日期与时间。本次未计为打卡。`;
}

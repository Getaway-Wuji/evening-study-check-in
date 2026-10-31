import {readLocation,LocationFailure,type LocationOptions,type StudyLocation} from './location';
export function browserLocation(options:LocationOptions={},geo=navigator.geolocation):Promise<StudyLocation>{
  return new Promise((resolve,reject)=>{
    if(!geo){reject(new LocationFailure('当前浏览器不支持定位，请在手机微信中打开','technical'));return;}
    const timeout=Math.max(1,options.timeoutMs??45000),target=options.targetAccuracy??50,maxAge=(options.maxAgeSeconds??60)*1000;
    let settled=false,watchId:number|undefined,best:StudyLocation|undefined,networkStarted=false;
    let deadline:ReturnType<typeof setTimeout>|undefined,networkTimer:ReturnType<typeof setTimeout>|undefined;
    const fresh=(p:StudyLocation)=>Number.isFinite(p.capturedAt)&&p.capturedAt>0&&Date.now()-p.capturedAt<=maxAge&&p.capturedAt<=Date.now()+10000;
    const clean=()=>{clearTimeout(deadline);clearTimeout(networkTimer);if(watchId!==undefined)geo.clearWatch(watchId);options.signal?.removeEventListener('abort',cancel);};
    const finish=(error?:Error,value?:StudyLocation)=>{if(settled)return;settled=true;clean();error?reject(error):resolve(value!);};
    const cancel=()=>finish(new LocationFailure('已取消定位，可重新尝试','cancelled'));
    const receive=(value:GeolocationPosition)=>{
      if(settled)return;
      try{
        if(!Number.isFinite(value.timestamp)||value.timestamp<=0)return;
        const point=readLocation(value.coords,'wgs84',value.timestamp);if(!fresh(point))return;
        if(!best||point.accuracy<best.accuracy||point.accuracy===best.accuracy&&point.capturedAt>best.capturedAt)best=point;
        options.onProgress?.({stage:best.accuracy<=target?'locating':'improving',accuracy:best.accuracy});
        if(best.accuracy<=target)finish(undefined,best);
      }catch{/* Ignore malformed samples; never manufacture an accuracy value. */}
    };
    const failure=(error:GeolocationPositionError)=>{
      if(settled)return;
      if(error.code===1){finish(new LocationFailure('未获得定位权限，请在手机系统和微信设置中允许精确定位','permission'));return;}
      network(); // A timeout from one source does not end the entire acquisition.
    };
    const network=()=>{
      if(settled||networkStarted)return;networkStarted=true;options.onProgress?.({stage:'network',accuracy:best?.accuracy});
      try{geo.getCurrentPosition(receive,error=>{if(error.code===1)failure(error);},{enableHighAccuracy:false,maximumAge:0,timeout:Math.max(1000,Math.min(12000,timeout))});}catch{/* The high-accuracy watch may still succeed. */}
    };
    if(options.signal?.aborted){cancel();return;}
    options.signal?.addEventListener('abort',cancel,{once:true});options.onProgress?.({stage:'locating'});
    deadline=setTimeout(()=>{if(best&&fresh(best))finish(undefined,best);else finish(new LocationFailure('本次仍未取得可靠位置。请到窗边或走廊重试，确认系统精确定位和 Wi-Fi 已开启；仍失败请联系管理员核实到场。','technical'));},timeout);
    networkTimer=setTimeout(network,Math.min(12000,Math.max(1,timeout/2)));
    try{
      if(typeof geo.watchPosition==='function'){watchId=geo.watchPosition(receive,failure,{enableHighAccuracy:true,maximumAge:0,timeout:Math.max(1000,Math.min(20000,timeout))});if(settled)geo.clearWatch(watchId);}
      else geo.getCurrentPosition(receive,failure,{enableHighAccuracy:true,maximumAge:0,timeout:Math.max(1000,timeout)});
    }catch{finish(new LocationFailure('无法启动定位，请检查手机定位服务与浏览器权限','technical'));}
  });
}

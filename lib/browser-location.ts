import {LocationFailure,type LocationOptions,type StudyLocation,type LocationDiagnostic,type LocationSampleIssue} from './location';
import {compatibleLocation} from './compatible-location';
import {browserPosition,invalidPositionMessage} from './browser-position';
export function browserLocation(options:LocationOptions={},geo=navigator.geolocation):Promise<StudyLocation>{
  if(geo&&options.strategy==='compatible')return compatibleLocation(options,geo);
  return new Promise((resolve,reject)=>{
    if(!geo){reject(new LocationFailure('当前浏览器不支持定位，请在手机微信中打开','technical'));return;}
    const timeout=Math.max(1,options.timeoutMs??45000),target=options.targetAccuracy??50,maxAge=(options.maxAgeSeconds??60)*1000,started=Date.now();
    let settled=false,watchId:number|undefined,best:StudyLocation|undefined,lastInvalid:LocationSampleIssue|undefined,networkStarted=false;
    let deadline:ReturnType<typeof setTimeout>|undefined,networkTimer:ReturnType<typeof setTimeout>|undefined;
    const fresh=(p:StudyLocation)=>Number.isFinite(p.capturedAt)&&p.capturedAt>0&&Date.now()-p.capturedAt<=maxAge&&p.capturedAt<=Date.now()+10000;
    const clean=()=>{clearTimeout(deadline);clearTimeout(networkTimer);if(watchId!==undefined)try{geo.clearWatch(watchId);}catch{/* Some embedded browsers expose only a partial geolocation API. */}options.signal?.removeEventListener('abort',cancel);};
    const finish=(error?:Error,value?:StudyLocation)=>{if(settled)return;settled=true;clean();error?reject(error):resolve(value!);};
    const cancel=()=>finish(new LocationFailure('已取消定位，可重新尝试','cancelled'));
    const receive=(value:GeolocationPosition,method:LocationDiagnostic['method']='watch')=>{
      if(settled)return;
      const parsed=browserPosition(value,maxAge),point=parsed.position;
      if(point){
        options.onDiagnostic?.({method,outcome:'sample',elapsedMs:Date.now()-started,accuracy:point.accuracy,sample:parsed.sample});
        if(!best||!fresh(best)||point.accuracy<best.accuracy||point.accuracy===best.accuracy&&point.capturedAt>best.capturedAt)best=point;
        options.onProgress?.({stage:best.accuracy<=target?'locating':'improving',accuracy:best.accuracy});
        if(best.accuracy<=target)finish(undefined,best);
      }else{lastInvalid=parsed.sample.issue;options.onDiagnostic?.({method,outcome:'invalid',elapsedMs:Date.now()-started,sample:parsed.sample});}
    };
    const failure=(error:GeolocationPositionError,method:LocationDiagnostic['method']='watch')=>{
      if(settled)return;
      options.onDiagnostic?.({method,outcome:'error',elapsedMs:Date.now()-started,code:[1,2,3].includes(error.code)?error.code:undefined});
      if(error.code===1){finish(new LocationFailure('未获得定位权限，请在手机系统和微信设置中允许精确定位','permission'));return;}
      network(); // A timeout from one source does not end the entire acquisition.
    };
    const network=()=>{
      if(settled||networkStarted)return;networkStarted=true;options.onProgress?.({stage:'network',accuracy:best?.accuracy});
      options.onDiagnostic?.({method:'single-balanced',outcome:'started',elapsedMs:Date.now()-started});
      try{geo.getCurrentPosition(value=>receive(value,'single-balanced'),error=>failure(error,'single-balanced'),{enableHighAccuracy:false,maximumAge:0,timeout:Math.max(1000,Math.min(12000,timeout))});}catch{/* The high-accuracy watch may still succeed. */}
    };
    if(options.signal?.aborted){cancel();return;}
    options.signal?.addEventListener('abort',cancel,{once:true});options.onProgress?.({stage:'locating'});
    deadline=setTimeout(()=>{if(best&&fresh(best))finish(undefined,best);else finish(new LocationFailure(lastInvalid?invalidPositionMessage(lastInvalid):'本次仍未取得可靠位置。请到窗边或走廊重试，确认系统精确定位和 Wi-Fi 已开启；仍失败请联系管理员核实到场。','technical'));},timeout);
    networkTimer=setTimeout(network,Math.min(12000,Math.max(1,timeout/2)));
    options.onDiagnostic?.({method:typeof geo.watchPosition==='function'?'watch':'single-high',outcome:'started',elapsedMs:0});
    try{
      if(typeof geo.watchPosition==='function'){watchId=geo.watchPosition(receive,failure,{enableHighAccuracy:true,maximumAge:0,timeout:Math.max(1000,Math.min(20000,timeout))});if(settled)geo.clearWatch(watchId);}
      else geo.getCurrentPosition(value=>receive(value,'single-high'),error=>failure(error,'single-high'),{enableHighAccuracy:true,maximumAge:0,timeout:Math.max(1000,timeout)});
    }catch{finish(new LocationFailure('无法启动定位，请检查手机定位服务与浏览器权限','technical'));}
  });
}

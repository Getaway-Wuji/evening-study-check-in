import {LocationFailure,type LocationOptions,type StudyLocation,type LocationDiagnostic,type LocationSampleIssue} from './location';
import {invalidPositionMessage} from './browser-position';
import {harmonyPosition} from './harmony-position';

// Huawei/ArkWeb compatibility: one-shot requests, without a concurrent high-accuracy watch.
export function compatibleLocation(options:LocationOptions,geo:Geolocation):Promise<StudyLocation>{
  return new Promise((resolve,reject)=>{
    const total=Math.max(1,options.timeoutMs??45000),started=Date.now(),deadlineAt=started+total,maxAge=(options.maxAgeSeconds??60)*1000,target=options.targetAccuracy??50;
    const plan=[{high:false,age:Math.min(15000,maxAge),share:0.28},{high:true,age:0,share:0.44},{high:false,age:0,share:0.28}];
    let settled=false,best:StudyLocation|undefined,lastInvalid:LocationSampleIssue|undefined,index=0,generation=0,attemptTimer:ReturnType<typeof setTimeout>|undefined,betweenTimer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
    const fresh=(p:StudyLocation)=>Number.isFinite(p.capturedAt)&&p.capturedAt>0&&Date.now()-p.capturedAt<=maxAge&&p.capturedAt<=Date.now()+10000;
    const diagnostic=(method:LocationDiagnostic['method'],outcome:LocationDiagnostic['outcome'],extra:Partial<LocationDiagnostic>={})=>options.onDiagnostic?.({method,outcome,elapsedMs:Date.now()-started,...extra});
    const finish=(error?:Error,value?:StudyLocation)=>{if(settled)return;settled=true;generation++;clearTimeout(deadline);clearTimeout(attemptTimer);clearTimeout(betweenTimer);options.signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value!);};
    const cancel=()=>finish(new LocationFailure('已取消定位，可重新尝试','cancelled'));
    const denied=()=>finish(new LocationFailure('未获得定位权限。请在手机权限管理中允许当前微信或浏览器访问位置信息，并开启精确位置；再允许本网站定位。','permission'));
    const exhausted=()=>{if(best&&fresh(best))finish(undefined,best);else finish(new LocationFailure(lastInvalid?invalidPositionMessage(lastInvalid):'系统仍未返回可靠位置。请检查手机定位及当前应用的精确位置权限，先在系统地图确认能定位后返回重试；可展开下方排查与诊断。','technical'));};
    function next(){
      if(settled)return;if(index>=plan.length||Date.now()>=deadlineAt){exhausted();return;}
      const attempt=index++,phase=plan[attempt],token=++generation,method=phase.high?'single-high':'single-balanced',requestedAt=Date.now(),budget=Math.max(1,Math.min(deadlineAt-requestedAt,Math.round(total*phase.share)));
      options.onProgress?.({stage:'compatible',attempt:attempt+1,accuracy:best?.accuracy});diagnostic(method,'started');
      // Yield out of the native callback before issuing another request to the host bridge.
      const advance=()=>{if(settled||token!==generation)return;clearTimeout(attemptTimer);generation++;betweenTimer=setTimeout(next,Math.min(250,Math.floor(total*0.005)));};
      attemptTimer=setTimeout(()=>{if(settled||token!==generation)return;diagnostic(method,'timeout',{code:3});advance();},budget);
      try{geo.getCurrentPosition(value=>{
        if(settled||token!==generation)return;
        const parsed=harmonyPosition(value,maxAge,{enabled:options.harmonyClockWorkaround===true,maximumAge:phase.age,startedAt:requestedAt}),point=parsed.position;
        if(point){
          diagnostic(method,'sample',{accuracy:point.accuracy,sample:parsed.sample});
          if(!best||!fresh(best)||point.accuracy<best.accuracy||point.accuracy===best.accuracy&&point.capturedAt>best.capturedAt)best=point;
          if(best.accuracy<=target){finish(undefined,best);return;}
          options.onProgress?.({stage:'improving',accuracy:best.accuracy});
        }else{lastInvalid=parsed.sample.issue;diagnostic(method,'invalid',{sample:parsed.sample});}
        advance();
      },error=>{
        if(settled)return;if(error.code===1){diagnostic(method,'error',{code:1});denied();return;}
        if(token!==generation)return;diagnostic(method,'error',{code:[2,3].includes(error.code)?error.code:undefined});advance();
      },{enableHighAccuracy:phase.high,maximumAge:phase.age,timeout:budget});}
      catch{diagnostic(method,'error');advance();}
    }
    if(options.signal?.aborted){cancel();return;}options.signal?.addEventListener('abort',cancel,{once:true});deadline=setTimeout(exhausted,total);next();
  });
}

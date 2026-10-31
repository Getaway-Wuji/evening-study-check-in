import {readLocation,wechatSignatureURL,LocationFailure,type StudyLocation,type LocationOptions} from './location';
import {browserLocation} from './browser-location';
type Signature={appId:string;timestamp:number;nonceStr:string;signature:string};
type SDK={config:(config:Signature&{debug:boolean;jsApiList:string[]})=>void;ready:(callback:()=>void)=>void;error:(callback:(error:{errMsg?:string})=>void)=>void;checkJsApi?:(input:{jsApiList:string[];success:(result:{checkResult:Record<string,boolean>|string})=>void;fail:()=>void})=>void;getLocation:(input:{type:'gcj02';success:(result:{latitude:unknown;longitude:unknown;accuracy:unknown})=>void;fail:(error:{errMsg?:string})=>void;cancel:()=>void})=>void};
declare global {interface Window {wx?:SDK;__studyEntryURL?:string}}
let sdkFlight:Promise<SDK>|undefined;
function loadSDK():Promise<SDK>{
  if(window.wx)return Promise.resolve(window.wx);
  if(sdkFlight)return sdkFlight;
  sdkFlight=new Promise<SDK>((resolve,reject)=>{
    let script=document.querySelector<HTMLScriptElement>('script[data-wechat-sdk]');
    if(script?.dataset.failed==='true'){script.remove();script=null;}
    const fresh=!script;
    if(!script){script=document.createElement('script');script.src='https://res.wx.qq.com/open/js/jweixin-1.6.0.js';script.dataset.wechatSdk='true';script.async=true;}
    const target=script;
    const clean=()=>{clearTimeout(timer);target.removeEventListener('load',loaded);target.removeEventListener('error',failed);};
    const failed=()=>{clean();target.dataset.failed='true';reject(new LocationFailure('微信定位组件加载失败','technical'));};
    const loaded=()=>{clean();if(window.wx)resolve(window.wx);else{target.dataset.failed='true';reject(new LocationFailure('微信定位组件暂时不可用','technical'));}};
    const timer=setTimeout(failed,10000);
    target.addEventListener('load',loaded,{once:true});target.addEventListener('error',failed,{once:true});
    if(fresh)document.head.appendChild(target);
  });
  sdkFlight.catch(()=>{sdkFlight=undefined;});return sdkFlight;
}
let configured:{url:string;promise:Promise<SDK>}|undefined;
async function configureSDK():Promise<SDK>{
  const url=wechatSignatureURL(navigator.userAgent,location.href,window.__studyEntryURL);
  if(configured?.url===url)return configured.promise;
  // Configure once at a time; old ready handlers must not issue a new location request.
  if(configured)await configured.promise.catch(()=>{});
  const promise=(async()=>{
    const wx=await loadSDK();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    let response:Response;
    try{response=await fetch('/api/wechat/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),cache:'no-store',signal:controller.signal});}finally{clearTimeout(timeout);}
    if(!response.ok)throw new LocationFailure('微信定位连接尚未完成','technical');
    const signature:Signature=await response.json();
    return new Promise<SDK>((resolve,reject)=>{
      let settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(wx);};
      const timer=setTimeout(()=>finish(new LocationFailure('微信定位验证超时','technical')),10000);
      try{
        wx.config({debug:false,...signature,jsApiList:['getLocation']});
        wx.error(()=>finish(new LocationFailure('微信定位验证失败，请联系管理员核对接口与域名','technical')));
        wx.ready(()=>{
          if(settled)return;
          if(!wx.checkJsApi){finish();return;}
          wx.checkJsApi({jsApiList:['getLocation'],success:result=>{
            try{const support=typeof result.checkResult==='string'?JSON.parse(result.checkResult):result.checkResult;finish(support?.getLocation===true?undefined:new LocationFailure('当前微信未开放定位接口','technical'));}catch{finish(new LocationFailure('微信定位能力验证失败','technical'));}
          },fail:()=>finish(new LocationFailure('微信定位能力验证失败','technical'))});
        });
      }catch{finish(new LocationFailure('微信定位组件无法初始化','technical'));}
    });
  })();
  configured={url,promise};
  try{return await promise;}catch(error){if(configured?.promise===promise)configured=undefined;throw error;}
}
async function wechatLocation(options:LocationOptions):Promise<StudyLocation>{
  const started=Date.now();
  const wx=await new Promise<SDK>((resolve,reject)=>{
    let settled=false;const finish=(error?:Error,sdk?:SDK)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);error?reject(error):resolve(sdk!);};
    const cancel=()=>finish(new LocationFailure('已取消定位，可重新尝试','cancelled'));
    const timer=setTimeout(()=>finish(new LocationFailure('微信定位准备超时','technical')),options.timeoutMs??45000);
    if(options.signal?.aborted){cancel();return;}options.signal?.addEventListener('abort',cancel,{once:true});
    configureSDK().then(sdk=>finish(undefined,sdk),error=>finish(error));
  });
  if(options.signal?.aborted)throw new LocationFailure('已取消定位，可重新尝试','cancelled');
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cancel=()=>finish(new LocationFailure('已取消定位，可重新尝试','cancelled'));
    const finish=(error?:Error,value?:StudyLocation)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value!);};
    const timer=setTimeout(()=>finish(new LocationFailure('微信定位暂未返回，正在尝试系统定位','technical')),Math.max(1,Math.min(20000,(options.timeoutMs??45000)-(Date.now()-started))));
    options.signal?.addEventListener('abort',cancel,{once:true});options.onProgress?.({stage:'wechat'});
    try{wx.getLocation({type:'gcj02',success:result=>{try{finish(undefined,readLocation(result,'gcj02'));}catch{finish(new LocationFailure('微信没有返回可靠定位精度','technical'));}},
      cancel:()=>finish(new LocationFailure('已取消定位，可点击“获取位置”重试','cancelled')),
      fail:error=>{if(/cancel/i.test(error.errMsg||'')){finish(new LocationFailure('已取消定位，可点击“获取位置”重试','cancelled'));return;}const denied=/deny|denied|permission|auth/i.test(error.errMsg||'');finish(new LocationFailure(denied?'定位权限未开启，请在系统和微信设置中允许定位':'微信定位暂时失败，请稍后重试',denied?'permission':'technical'));}});
    }catch{finish(new LocationFailure('微信定位调用失败','technical'));}
  });
}
export async function acquireLocation(wechatConfigured:boolean,options:LocationOptions={}):Promise<{position:StudyLocation;source:'wechat'|'system';fallback:boolean}>{
  if(!window.isSecureContext)throw new Error('定位需要安全连接，请使用网站的 HTTPS 正式地址');
  if(options.signal?.aborted)throw new LocationFailure('已取消定位，可重新尝试','cancelled');
  const deadline=Date.now()+(options.timeoutMs??45000),remaining=()=>({...options,timeoutMs:Math.max(1,deadline-Date.now())});
  if(wechatConfigured&&/MicroMessenger/i.test(navigator.userAgent)){
    try{const position=await wechatLocation(remaining());if(position.accuracy<=(options.targetAccuracy??50))return {position,source:'wechat',fallback:false};}
    catch(error){if(error instanceof LocationFailure&&error.kind!=='technical')throw error;configured=undefined;}
    if(options.signal?.aborted)throw new LocationFailure('已取消定位，可重新尝试','cancelled');
    if(Date.now()>=deadline)throw new LocationFailure('本次定位耗时较长，请到窗边或走廊重新尝试','technical');
    return {position:await browserLocation(remaining()),source:'system',fallback:true};
  }
  return {position:await browserLocation(remaining()),source:'system',fallback:false};
}

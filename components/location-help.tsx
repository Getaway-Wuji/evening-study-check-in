'use client';
import {useEffect,useState} from 'react';
import {Button} from './common';
import styles from './location-help.module.css';
export default function LocationHelp({error,busy,report,onRetry,retryLabel='使用兼容模式重试',disabled=false}:{error:string;busy:boolean;report:string;onRetry:()=>void;retryLabel?:string;disabled?:boolean}){
  const [copied,setCopied]=useState(false),[manualCopy,setManualCopy]=useState(false);
  useEffect(()=>{setCopied(false);setManualCopy(false);},[report]);
  if(!error||busy)return null;
  return <details open className={styles.panel}>
    <summary>定位失败排查 · 华为／鸿蒙也适用</summary>
    <div className={styles.actions}>
      <Button type="button" disabled={disabled} onClick={onRetry}>{retryLabel}</Button>
      {report&&<Button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(report);setCopied(true);}catch{setManualCopy(true);}}}>{copied?'诊断已复制':'复制定位诊断'}</Button>}
    </div>
    <ol>
      <li>在手机设置中打开定位服务；在权限管理中允许当前使用的微信或浏览器访问位置信息，并打开“精确位置”（若系统提供）。网页自己的定位权限也需允许。</li>
      <li>先在手机地图中确认能取得当前位置，再回到本页面重试。地图应用的授权不能代替微信或浏览器的授权。</li>
      <li>保持页面在前台，可到窗边或室外开阔位置尝试。兼容模式仍使用手机系统定位，不会扩大打卡范围或伪造精度。</li>
    </ol>
    <p>诊断包含浏览器、定位策略、耗时、错误码及位置时间和精度的字段信息，不含姓名、学号或经纬度，不会自动上传。若仍失败，可将诊断和手机型号、系统版本交给管理员排查。</p>
    {report&&<details open={manualCopy}><summary>查看定位诊断（可长按复制）</summary><textarea className={styles.report} aria-label="定位诊断内容" value={report} readOnly rows={8}/></details>}
    <a href="https://consumer.huawei.com/cn/support/content/zh-cn16010262/" target="_blank" rel="noreferrer">华为浏览器网站定位权限设置</a>
    <br/><a href="https://consumer.huawei.com/cn/support/content/zh-cn16044374/" target="_blank" rel="noreferrer">查看华为官方定位排查说明</a>
  </details>;
}

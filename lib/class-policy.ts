import {leaveKinds,type Rules} from './domain';
export interface LeaveType {id:string;name:string;enabled:boolean;reasonRequired:boolean;proofRequired:boolean}
export interface ClassPolicy {
  leaveTypes:LeaveType[];
  leave:{maxSessions:number;reasonMinLength:number;reasonMaxLength:number;deadline:'open'|'studyStart'|'close';advanceMinutes:number};
  uploads:{photoMaxFiles:number;proofMaxFiles:number;photoMaxMB:number;proofMaxMB:number;proofPdfEnabled:boolean};
  notifications:{enabled:boolean;maxAttempts:number;retryMinutes:number[]};
  noteMaxLength:number;studentNotice:string;
}
export const defaultClassPolicy:ClassPolicy={
  leaveTypes:Object.entries(leaveKinds).map(([id,name])=>({id,name,enabled:true,reasonRequired:id!=='free',proofRequired:true})),
  leave:{maxSessions:30,reasonMinLength:2,reasonMaxLength:1000,deadline:'close',advanceMinutes:0},
  uploads:{photoMaxFiles:5,proofMaxFiles:5,photoMaxMB:10,proofMaxMB:10,proofPdfEnabled:true},
  notifications:{enabled:true,maxAttempts:5,retryMinutes:[1,5,15,60,180]},noteMaxLength:500,studentNotice:'',
};
export function resolveClassPolicy(value?:Partial<ClassPolicy>|null):ClassPolicy{
  const defaults=structuredClone(defaultClassPolicy);
  return {...defaults,...value,leave:{...defaults.leave,...value?.leave},uploads:{...defaults.uploads,...value?.uploads},notifications:{...defaults.notifications,...value?.notifications,retryMinutes:[...(value?.notifications?.retryMinutes??defaults.notifications.retryMinutes)]},leaveTypes:structuredClone(value?.leaveTypes??defaults.leaveTypes)};
}
export function leaveLabel(leave:{kind:string;kindLabel?:string|null;kind_label?:string|null},policy:ClassPolicy){
  return leave.kindLabel||leave.kind_label||(Object.hasOwn(leaveKinds,leave.kind)?leaveKinds[leave.kind]:undefined)||policy.leaveTypes.find(t=>t.id===leave.kind)?.name||leave.kind;
}
export function needsLeaveProof(rules:Rules,type:LeaveType){return Object.hasOwn(rules.proofRequired,type.id)?rules.proofRequired[type.id]:type.proofRequired;}
export function leaveDeadline(date:string,rules:Rules,policy:ClassPolicy){
  const key=policy.leave.deadline;
  return Date.parse(`${date}T${rules[key]}:00+08:00`)+(key==='close'?60000:0)-policy.leave.advanceMinutes*60000;
}
export function uploadLimits(policy:ClassPolicy,purpose:'photo'|'proof'){
  return {maxFiles:purpose==='photo'?policy.uploads.photoMaxFiles:policy.uploads.proofMaxFiles,maxMB:purpose==='photo'?policy.uploads.photoMaxMB:policy.uploads.proofMaxMB,
    allowedTypes:purpose==='proof'&&policy.uploads.proofPdfEnabled?['image/jpeg','image/png','application/pdf']:['image/jpeg','image/png']};
}
export function validateUploadMetadata(file:{size:number;content_type:string;purpose:'photo'|'proof'},policy:ClassPolicy){
  const limits=uploadLimits(policy,file.purpose);
  if(file.size<=0||file.size>limits.maxMB*1024*1024)throw new Error(`每个${file.purpose==='photo'?'照片':'证明'}文件不得超过 ${limits.maxMB} MB`);
  if(!limits.allowedTypes.includes(file.content_type))throw new Error(file.purpose==='proof'?'本班当前只接受 JPG、PNG 图片证明':'打卡照片必须为 JPG、PNG 图片');
}

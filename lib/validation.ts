import { z } from 'zod';
import { validDate,timeMinutes } from './domain';
export const classPolicySchema=z.object({
  leaveTypes:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine(id=>!['constructor','prototype','__proto__'].includes(id)),name:z.string().trim().min(1).max(30),enabled:z.boolean(),reasonRequired:z.boolean(),proofRequired:z.boolean()})).min(1).max(30)
    .refine(types=>new Set(types.map(t=>t.id)).size===types.length,'请假类型编号重复')
    .refine(types=>types.some(t=>t.enabled),'请至少启用一种请假类型')
    .refine(types=>{const names=types.filter(t=>t.enabled).map(t=>t.name);return new Set(names).size===names.length;},'启用中的请假类型名称不能重复'),
  leave:z.object({maxSessions:z.number().int().min(1).max(366),reasonMinLength:z.number().int().min(1).max(5000),reasonMaxLength:z.number().int().min(1).max(5000),deadline:z.enum(['open','studyStart','close']),advanceMinutes:z.number().int().min(0).max(10080)})
    .refine(v=>v.reasonMinLength<=v.reasonMaxLength,'请假说明最少字数不能超过最多字数'),
  uploads:z.object({photoMaxFiles:z.number().int().min(1).max(20),proofMaxFiles:z.number().int().min(1).max(20),photoMaxMB:z.number().int().min(1).max(10),proofMaxMB:z.number().int().min(1).max(10),proofPdfEnabled:z.boolean()}),
  notifications:z.object({enabled:z.boolean(),maxAttempts:z.number().int().min(1).max(10),retryMinutes:z.array(z.number().int().min(1).max(1440)).min(1).max(10)}),
  makeup:z.object({enabled:z.boolean(),hoursAfterClose:z.number().int().min(1).max(720)}).default({enabled:true,hoursAfterClose:24}),
  noteMaxLength:z.number().int().min(1).max(2000),studentNotice:z.string().trim().max(2000),
});
export const daySchema=z.string().refine(validDate,'日期无效');
export const weekdaysSchema=z.array(z.number().int().min(0).max(6)).min(1,'请至少选择一天晚自习').max(7)
  .refine(days=>new Set(days).size===days.length,'星期不能重复')
  .transform(days=>[...days].sort((a,b)=>(a+6)%7-(b+6)%7));
export const classCapacitySchema=z.number().int().positive().nullable();
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const studyTimesSchema=z.object({studyStart:time,open:time,close:time})
  .refine(v=>timeMinutes(v.open)<timeMinutes(v.close),'打卡开放时间必须早于截止时间');
export const rulesSchema=z.object({
  studyStart:time,open:time,close:time,
  locationName:z.string().trim().min(1).max(80),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),
  radius:z.number().int().min(10).max(2000),locationRequired:z.boolean(),locationConfirmed:z.boolean().default(false),accuracyLimit:z.number().int().min(5).max(200),locationMaxAge:z.number().int().min(15).max(120),
  photoEnabled:z.boolean().optional(),photoRequired:z.boolean(),cameraOnly:z.boolean(),noteEnabled:z.boolean().optional(),noteRequired:z.boolean(),
  proofRequired:z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine(id=>!['constructor','prototype'].includes(id)),z.boolean()),
}).refine(v=>timeMinutes(v.open)<timeMinutes(v.close),'打卡开放时间必须早于截止时间')
  .refine(v=>!v.photoRequired||v.photoEnabled!==false,'照片必填时必须启用照片字段')
  .refine(v=>!v.noteRequired||v.noteEnabled!==false,'备注必填时必须启用备注字段');

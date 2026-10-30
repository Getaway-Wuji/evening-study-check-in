import { z } from 'zod';
import { validDate,timeMinutes } from './domain';
export const daySchema=z.string().refine(validDate,'日期无效');
export const classCapacitySchema=z.number().int().positive().nullable();
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const rulesSchema=z.object({
  studyStart:time,open:time,close:time,
  locationName:z.string().trim().min(1).max(80),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),
  radius:z.number().int().min(10).max(2000),locationRequired:z.boolean(),locationConfirmed:z.boolean().default(false),accuracyLimit:z.number().int().min(5).max(200),locationMaxAge:z.number().int().min(15).max(120),
  photoEnabled:z.boolean().optional(),photoRequired:z.boolean(),cameraOnly:z.boolean(),noteEnabled:z.boolean().optional(),noteRequired:z.boolean(),
  proofRequired:z.object({personal:z.boolean(),sick:z.boolean(),free:z.boolean()}),weekdays:z.array(z.number().int().min(0).max(6)).min(1),
}).refine(v=>timeMinutes(v.open)<timeMinutes(v.close),'打卡开放时间必须早于截止时间')
  .refine(v=>!v.photoRequired||v.photoEnabled!==false,'照片必填时必须启用照片字段')
  .refine(v=>!v.noteRequired||v.noteEnabled!==false,'备注必填时必须启用备注字段');

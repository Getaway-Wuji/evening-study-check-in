import type {bootstrap} from './service';
type Data=Awaited<ReturnType<typeof bootstrap>>;
export interface AttendanceChange {
  sessionId:string;userId:string;now:number;
  checkin?:Data['checkins'][number];
  review?:{id:string;status:'approved'|'rejected';review_note:string;reviewer_id:string;reviewed_at:number;checkin_id:string|null};
  invalidate?:{leaveNote:string;makeupNote?:string;reviewedAt:number;reviewerId?:string};
}

// Apply only the result of a committed server operation. A later full refresh
// reconciles audit logs and unrelated records without blocking the review dialog.
export function applyAttendanceChange(d:Data,change:AttendanceChange):Data{
  const matches=(row:Record<string,unknown>)=>row.user_id===change.userId&&row.session_id===change.sessionId;
  const invalidation=change.invalidate;
  return {...d,now:change.now,
    checkins:change.checkin?[...d.checkins.filter(c=>c.id!==change.checkin!.id),change.checkin]:d.checkins,
    makeups:d.makeups.map(m=>m.id===change.review?.id?{...m,...change.review}:invalidation?.makeupNote&&matches(m)&&m.status==='pending'?{...m,status:'invalid',review_note:invalidation.makeupNote,reviewed_at:invalidation.reviewedAt}:m),
    leaves:invalidation?d.leaves.map(l=>l.user_id!==change.userId?l:{...l,items:l.items.map(i=>matches(i)&&i.status==='pending'?{...i,status:'invalid',review_note:invalidation.leaveNote,reviewed_at:invalidation.reviewedAt,...(invalidation.reviewerId?{reviewer_id:invalidation.reviewerId}:{})}:i)}):d.leaves,
  };
}

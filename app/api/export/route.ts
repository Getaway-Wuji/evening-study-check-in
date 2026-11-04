import { NextRequest,NextResponse } from 'next/server';
import { requireUser,errorResponse } from '@/lib/auth';
import { bootstrap } from '@/lib/service';
import {studentState} from '@/lib/attendance';
import { safeCSV } from '@/lib/domain';
import { audit } from '@/lib/db';
export async function GET(req:NextRequest){try{
  const user=await requireUser('admin'),d=await bootstrap(user),from=req.nextUrl.searchParams.get('from')||'',to=req.nextUrl.searchParams.get('to')||'9999-12-31';
  const records:unknown[][]=[['日期','学号','姓名','状态','打卡时间','距离米','备注']];
  for(const s of d.sessions.filter(s=>!s.cancelled&&s.date>=from&&s.date<=to))for(const m of d.members.filter(m=>m.session_id===s.id)){
    const student=d.students.find(u=>u.id===m.user_id);if(!student)continue;
    const state=studentState(d,s,student.id),c=state.record;
    const status=c?(c.method==='makeup'?'实到（人工补签）':c.method==='manual'?'实到（管理员补录）':'实到'):state.key==='leave'?'已批准请假':state.key==='waiting'?'待打卡':state.label;
    records.push([s.date,student.code,student.name,status,c?new Date(c.submitted_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'',c?.distance??'',c?.note??'']);
  }
  await audit(user.id,'导出考勤',{from,to,rows:records.length-1});
  return new NextResponse('\ufeff'+records.map(row=>row.map(safeCSV).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="attendance.csv"','Cache-Control':'private,no-store'}});
}catch(e){return errorResponse(e);}}

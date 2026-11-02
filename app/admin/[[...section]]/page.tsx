import Dashboard from '@/components/dashboard';
import { currentUser } from '@/lib/auth';
import { redirect,notFound } from 'next/navigation';
import {bootstrap} from '@/lib/service';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{section?:string[]}>}){
  const user=await currentUser();if(!user)redirect('/login');if(user.role!=='admin')redirect('/student');
  const {section}=await params;const name=section?.[0]||'overview';
  if((section?.length||0)>1||!['overview','attendance','leaves','makeup','schedule','students','settings','notifications'].includes(name))notFound();
  let initialData;try{initialData=await bootstrap(user);}catch{console.error('Initial dashboard data unavailable; client will retry.');}
  return <Dashboard mode="admin" section={name} initialData={initialData}/>;
}

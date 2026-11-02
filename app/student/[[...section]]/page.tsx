import Dashboard from '@/components/dashboard';
import { currentUser } from '@/lib/auth';
import { redirect,notFound } from 'next/navigation';
import {bootstrap} from '@/lib/service';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{section?:string[]}>}){
  const user=await currentUser();if(!user)redirect('/login');if(user.role!=='student')redirect('/admin');
  const {section}=await params,name=section?.[0]||'overview';
  if((section?.length||0)>1||!['overview','history','leave','makeup','profile'].includes(name))notFound();
  let initialData;try{initialData=await bootstrap(user);}catch{console.error('Initial dashboard data unavailable; client will retry.');}
  return <Dashboard mode="student" section={name} initialData={initialData}/>;
}

import Dashboard from '@/components/dashboard';
import { currentUser } from '@/lib/auth';
import { redirect,notFound } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{section?:string[]}>}){
  const user=await currentUser();if(!user)redirect('/login');if(user.role!=='student')redirect('/admin');
  const {section}=await params,name=section?.[0]||'overview';
  if((section?.length||0)>1||!['overview','history','leave','makeup','profile'].includes(name))notFound();
  return <Dashboard mode="student" section={name}/>;
}

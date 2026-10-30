import Login from '@/components/login';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page(){if(!(await cookies()).get('wechat_pending'))redirect('/login');return <Login bind demo={false} wechat={false}/>;}

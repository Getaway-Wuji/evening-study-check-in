import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { needsSetup } from '@/lib/setup';
import { headers } from 'next/headers';
import { wechatReady } from '@/lib/wechat';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();if(!user&&await needsSetup())redirect('/setup');if(!user&&wechatReady()&&/MicroMessenger/i.test((await headers()).get('user-agent')||''))redirect('/api/auth/wechat/start');redirect(user?user.role==='admin'?'/admin':'/student':'/login');}

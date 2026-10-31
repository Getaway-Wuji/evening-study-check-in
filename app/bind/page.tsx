import Login from '@/components/login';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {hash} from '@/lib/auth';
import {ready,one} from '@/lib/db';
export const dynamic='force-dynamic';
export default async function Page(){const pending=(await cookies()).get('wechat_pending')?.value;if(!pending)redirect('/login?notice=wechat-expired');await ready();if(!await one('SELECT token_hash FROM wechat_pending WHERE token_hash=? AND expires_at>?',[hash(pending),Date.now()]))redirect('/login?notice=wechat-expired');return <Login bind demo={false} wechat={false}/>;}

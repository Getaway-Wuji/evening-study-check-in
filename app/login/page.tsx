import Login from '@/components/login';
import { demoMode } from '@/lib/db';
import { wechatReady,wechatSetup } from '@/lib/wechat';
import { needsSetup } from '@/lib/setup';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page(){if(await needsSetup())redirect('/setup');return <Login demo={demoMode()} wechat={wechatReady()} wechatEnabled={wechatSetup().oauthEnabled}/>;}

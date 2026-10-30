import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { needsSetup } from '@/lib/setup';
export const dynamic='force-dynamic';
export default async function Home(){const user=await currentUser();if(!user&&await needsSetup())redirect('/setup');redirect(user?user.role==='admin'?'/admin':'/student':'/login');}

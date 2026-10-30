import { redirect } from 'next/navigation';
import { needsSetup,localSetupAllowed } from '@/lib/setup';
import Setup from '@/components/setup';
export const dynamic='force-dynamic';
export default async function Page(){
  if(!await needsSetup())redirect('/login');
  return <Setup requiresToken={!!process.env.SETUP_TOKEN||!localSetupAllowed()} local={localSetupAllowed()}/>;
}

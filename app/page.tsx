import { auth } from '../auth';
import InterviewApp from './components/InterviewApp';
import LoginPage from './components/LoginPage';
import { getActiveAdministrator } from '../lib/supabase-admin';

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) return <LoginPage />;

  const administrator = await getActiveAdministrator(email);
  return <InterviewApp userEmail={email} isAdministrator={Boolean(administrator)} />;
}

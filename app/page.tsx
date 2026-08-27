import { auth } from '../auth';
import InterviewApp from './components/InterviewApp';
import LoginPage from './components/LoginPage';

export default async function Home() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) return <LoginPage />;

  return <InterviewApp userEmail={email} />;
}

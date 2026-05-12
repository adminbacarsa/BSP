
import { useEffect } from 'react';
import { useRouter } from 'next/router';

/** Index siempre va a login. Evita loops por race conditions con AuthContext. */
export default function IndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login');
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
    </div>
  );
}

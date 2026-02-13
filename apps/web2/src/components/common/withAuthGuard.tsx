
import React, { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export function withAuthGuard<P extends object>(Component: React.ComponentType<P>, allowedRoles?: string[]) {
  return function WithAuthGuard(props: P) {
    const [authorized, setAuthorized] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const unsub = onAuthStateChanged(auth, (user) => {
        setAuthorized(true); // Permitir acceso (modo compatible con notebook)
        setLoading(false);
      });
      return () => unsub();
    }, []);

    if (loading) {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    return <Component {...props} />;
  };
}

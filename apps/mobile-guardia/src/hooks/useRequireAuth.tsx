import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { usePortalAuth } from '../context/PortalAuthContext';
import { LoadingScreen } from '../components/LoadingScreen';

export function useRequireAuth(): {
  ready: boolean;
  user: ReturnType<typeof usePortalAuth>['user'];
} {
  const { user, initializing, deviceVerified } = usePortalAuth();

  if (initializing) {
    return { ready: false, user: null };
  }

  if (!user) {
    return { ready: false, user: null };
  }

  if (deviceVerified === false) {
    return { ready: false, user };
  }

  return { ready: true, user };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing, deviceVerified } = usePortalAuth();

  if (initializing) {
    return <LoadingScreen label="Iniciando COSP Guardia…" />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (deviceVerified === false) {
    return <Redirect href="/device-blocked" />;
  }

  return children;
}

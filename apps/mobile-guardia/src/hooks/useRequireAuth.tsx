import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { usePortalAuth } from '../context/PortalAuthContext';
import { LoadingScreen } from '../components/LoadingScreen';

/** Auth para pantallas del modo Guardia (tabs). */
export function useRequireAuth(): {
  ready: boolean;
  user: ReturnType<typeof usePortalAuth>['user'];
} {
  const { user, initializing, deviceVerified, isSuperAdmin, isPreviewMode, staffProfile, activeMode } =
    usePortalAuth();

  if (initializing) {
    return { ready: false, user: null };
  }

  if (!user) {
    return { ready: false, user: null };
  }

  if (activeMode && activeMode !== 'guardia' && !isPreviewMode) {
    return { ready: false, user };
  }

  if (deviceVerified !== true && !(isSuperAdmin && isPreviewMode)) {
    return { ready: false, user };
  }

  if (isSuperAdmin && !isPreviewMode && !staffProfile?.isGuard) {
    return { ready: false, user };
  }

  return { ready: true, user };
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing, deviceVerified, isSuperAdmin, isPreviewMode, staffProfile, activeMode } =
    usePortalAuth();

  if (initializing) {
    return <LoadingScreen label="Iniciando COSP…" />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (activeMode && activeMode !== 'guardia' && !isPreviewMode) {
    return <Redirect href="/" />;
  }

  if (isSuperAdmin && !isPreviewMode && !staffProfile?.isGuard && activeMode !== 'guardia') {
    return <Redirect href="/preview" />;
  }

  if (deviceVerified === null) {
    return <LoadingScreen label="Validando dispositivo…" />;
  }

  if (deviceVerified === false) {
    return <Redirect href="/device-blocked" />;
  }

  return children;
}

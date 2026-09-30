import { Redirect } from 'expo-router';
import { APP_MODE_DEFS } from '@cosp/ops-core';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { appRoutes } from '../src/lib/appRoutes';

export default function IndexScreen() {
  const {
    user,
    initializing,
    deviceVerified,
    isSuperAdmin,
    isPreviewMode,
    staffProfile,
    activeMode,
  } = usePortalAuth();

  if (initializing) {
    return <LoadingScreen label="Iniciando COSP…" />;
  }

  if (!user) {
    return <Redirect href={appRoutes.login} />;
  }

  // Preview SuperAdmin con legajo atado → flujo guardia.
  if (isSuperAdmin && isPreviewMode) {
    return <Redirect href={appRoutes.hoy} />;
  }

  // SuperAdmin sin preview y sin modo aún → picker de preview (no romper).
  if (isSuperAdmin && !staffProfile?.isGuard && !activeMode) {
    return <Redirect href={appRoutes.preview} />;
  }

  const mode = activeMode || (staffProfile?.isGuard ? 'guardia' : null);

  if (mode && mode !== 'guardia') {
    const def = APP_MODE_DEFS.find((m) => m.id === mode);
    if (def) return <Redirect href={def.href as never} />;
  }

  // Modo Guardia: gate de dispositivo.
  if (deviceVerified === null && staffProfile?.isGuard) {
    return <LoadingScreen label="Validando dispositivo…" />;
  }

  if (deviceVerified === false && staffProfile?.isGuard) {
    // Dual: si también es staff, mandar a un modo staff; si no, bloqueo.
    if (staffProfile.isStaff || staffProfile.isSuperAdmin) {
      const staffMode = APP_MODE_DEFS.find(
        (m) => m.id !== 'guardia' && (staffProfile.isSuperAdmin || (m.moduleKey && staffProfile.modules[m.moduleKey]?.includes('read'))),
      );
      if (staffMode) return <Redirect href={staffMode.href as never} />;
    }
    return <Redirect href="/device-blocked" />;
  }

  if (staffProfile && !staffProfile.isGuard && (staffProfile.isStaff || staffProfile.isSuperAdmin)) {
    const firstStaff = APP_MODE_DEFS.find((m) => m.id !== 'guardia');
    const preferred =
      APP_MODE_DEFS.find((m) => m.id === activeMode && m.id !== 'guardia') ||
      APP_MODE_DEFS.find(
        (m) =>
          m.id !== 'guardia' &&
          (staffProfile.isSuperAdmin || (m.moduleKey && staffProfile.modules[m.moduleKey]?.includes('read'))),
      ) ||
      firstStaff;
    if (preferred) return <Redirect href={preferred.href as never} />;
  }

  return <Redirect href={appRoutes.hoy} />;
}

import { Redirect } from 'expo-router';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { appRoutes } from '../src/lib/appRoutes';

export default function IndexScreen() {
  const { user, initializing, deviceVerified, isSuperAdmin, isPreviewMode } = usePortalAuth();

  if (initializing) {
    return <LoadingScreen label="Iniciando COSP Guardia…" />;
  }

  if (!user) {
    return <Redirect href={appRoutes.login} />;
  }

  if (isSuperAdmin && !isPreviewMode) {
    return <Redirect href={appRoutes.preview} />;
  }

  if (deviceVerified === false) {
    return <Redirect href="/device-blocked" />;
  }

  return <Redirect href={appRoutes.hoy} />;
}

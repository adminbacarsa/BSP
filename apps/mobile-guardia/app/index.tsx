import { Redirect } from 'expo-router';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';

export default function IndexScreen() {
  const { user, initializing, deviceVerified, isSuperAdmin, isPreviewMode } = usePortalAuth();

  if (initializing) {
    return <LoadingScreen label="Iniciando COSP Guardia…" />;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (isSuperAdmin && !isPreviewMode) {
    return <Redirect href="/preview" />;
  }

  if (deviceVerified === false) {
    return <Redirect href="/device-blocked" />;
  }

  return <Redirect href="/home" />;
}

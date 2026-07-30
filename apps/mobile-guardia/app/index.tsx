import { Redirect } from 'expo-router';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';

export default function IndexScreen() {
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

  return <Redirect href="/home" />;
}

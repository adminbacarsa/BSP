import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { ModeSelectorBar } from '../../src/components/ModeSelectorBar';

export default function StaffLayout() {
  const { initializing, user, staffProfile } = usePortalAuth();

  if (initializing) return <LoadingScreen label="Iniciando COSP…" />;
  if (!user) return <Redirect href="/login" />;
  if (!staffProfile?.isStaff && !staffProfile?.isSuperAdmin) {
    return <Redirect href="/" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ModeSelectorBar />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontWeight: '800', fontSize: 17 },
        }}
      >
        <Stack.Screen name="operacion" options={{ title: 'Operación' }} />
        <Stack.Screen name="supervision" options={{ title: 'Supervisión' }} />
        <Stack.Screen name="rrhh" options={{ title: 'RRHH' }} />
        <Stack.Screen name="planificacion" options={{ title: 'Planificación' }} />
      </Stack>
    </View>
  );
}

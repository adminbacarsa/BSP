import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PortalAuthProvider } from '../src/context/PortalAuthContext';
import { colors } from '../src/theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PortalAuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.indigo900 },
            headerTintColor: colors.white,
            headerTitleStyle: { fontWeight: '800', fontSize: 17 },
            headerShadowVisible: true,
            contentStyle: { backgroundColor: colors.slate50 },
          }}
        />
      </PortalAuthProvider>
    </SafeAreaProvider>
  );
}

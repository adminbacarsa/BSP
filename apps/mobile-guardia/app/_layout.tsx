import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PortalAuthProvider, usePortalAuth } from '../src/context/PortalAuthContext';
import { colors } from '../src/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { initializing } = usePortalAuth();

  useEffect(() => {
    const fallback = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 12_000);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (!initializing) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [initializing]);

  return (
    <>
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
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PortalAuthProvider>
        <RootNavigator />
      </PortalAuthProvider>
    </SafeAreaProvider>
  );
}

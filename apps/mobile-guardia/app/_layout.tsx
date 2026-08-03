import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PortalAuthProvider, usePortalAuth } from '../src/context/PortalAuthContext';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { PushNotificationsBootstrap } from '../src/components/PushNotificationsBootstrap';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { initializing } = usePortalAuth();
  const { palette, isDark } = useTheme();

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
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.header },
          headerTintColor: palette.headerTint,
          headerTitleStyle: { fontWeight: '800', fontSize: 17 },
          headerShadowVisible: !isDark,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PortalAuthProvider>
          <PushNotificationsBootstrap />
          <RootNavigator />
        </PortalAuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

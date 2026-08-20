import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { PortalAuthProvider, usePortalAuth } from '../src/context/PortalAuthContext';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { PushNotificationsBootstrap } from '../src/components/PushNotificationsBootstrap';
import { AppUpdateBootstrap } from '../src/components/AppUpdateBootstrap';
import { OfflineBanner } from '../src/components/OfflineBanner';

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
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false, title: 'Ingreso' }} />
        <Stack.Screen name="preview" options={{ title: 'Preview SuperAdmin' }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="agenda" options={{ headerShown: false }} />
        <Stack.Screen name="mas" options={{ headerShown: false }} />
        <Stack.Screen name="eventos" options={{ title: 'Eventos' }} />
        <Stack.Screen name="permutas" options={{ title: 'Permutas' }} />
        <Stack.Screen name="novedad" options={{ title: 'Novedad' }} />
        <Stack.Screen name="credencial" options={{ title: 'Credencial' }} />
        <Stack.Screen name="device-blocked" options={{ title: 'Dispositivo' }} />
        <Stack.Screen name="activar" options={{ title: 'Activar' }} />
        <Stack.Screen name="empleado/activar" options={{ title: 'Activar' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PortalAuthProvider>
          <PushNotificationsBootstrap />
          <AppUpdateBootstrap />
          <OfflineBanner />
          <RootNavigator />
        </PortalAuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

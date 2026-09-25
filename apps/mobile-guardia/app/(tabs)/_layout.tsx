import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { usePortalInbox } from '../../src/hooks/usePortalInbox';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useTheme } from '../../src/theme/ThemeContext';

const TAB_CONTENT = 56;

export default function TabsLayout() {
  const { palette, isDark } = useTheme();
  const { user, portalFeatures, previewEmpDocId, deviceVerified, initializing } = usePortalAuth();
  const { unreadCount } = usePortalInbox(user, previewEmpDocId);
  const insets = useSafeAreaInsets();
  /**
   * Barra de 3 botones / gestos Android. Mínimo 28px si el inset llega 0
   * (algunos OEM reportan mal el safe area).
   */
  const bottom = Math.max(insets.bottom, Platform.OS === 'android' ? 28 : 8);

  // Gate: sin tabs ni badge de alertas hasta deviceVerified === true.
  if (initializing || deviceVerified === null) {
    return <LoadingScreen label="Validando dispositivo…" />;
  }
  if (deviceVerified === false) {
    return <Redirect href="/device-blocked" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.header },
        headerTintColor: palette.headerTint,
        headerTitleStyle: { fontWeight: '800', fontSize: 17 },
        headerShadowVisible: !isDark,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.onSurfaceMuted,
        tabBarStyle: {
          backgroundColor: palette.card,
          borderTopColor: palette.cardBorder,
          borderTopWidth: 1,
          height: TAB_CONTENT + bottom,
          paddingBottom: bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hoy',
          tabBarLabel: 'Hoy',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          href: portalFeatures.viewSchedule ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="alertas"
        options={{
          title: 'Alertas',
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: palette.error,
            color: '#fff',
            fontSize: 10,
            fontWeight: '800',
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="mas"
        options={{
          title: 'Más',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

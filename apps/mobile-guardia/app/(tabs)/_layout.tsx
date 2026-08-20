import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { usePortalInbox } from '../../src/hooks/usePortalInbox';
import { useTheme } from '../../src/theme/ThemeContext';

export default function TabsLayout() {
  const { palette, isDark } = useTheme();
  const { user, portalFeatures } = usePortalAuth();
  const { unreadCount } = usePortalInbox(user);

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
          height: 60,
          paddingBottom: 6,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hoy',
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

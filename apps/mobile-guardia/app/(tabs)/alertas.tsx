import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { radius, spacing } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePortalInbox, type PortalInboxItem } from '../../src/hooks/usePortalInbox';
import {
  notificationActionLabel,
  notificationDomainLabel,
  routeFromNotificationData,
} from '../../src/lib/notificationNavigation';
import { getPortalCallables } from '../../src/lib/portal';
import { appRoutes } from '../../src/lib/appRoutes';
import type { Href } from 'expo-router';

const DOMAIN_FILTERS = ['Todas', 'Planificación', 'Operaciones', 'Eventos', 'RRHH', 'Permutas', 'Sistema'] as const;
type DomainFilter = (typeof DOMAIN_FILTERS)[number];

function hrefFromRoute(route: string): Href {
  if (route === '/(tabs)' || route === '/(tabs)/') return appRoutes.hoy;
  if (route === '/(tabs)/agenda') return appRoutes.agenda;
  if (route === '/(tabs)/alertas') return appRoutes.alertas;
  if (route === '/(tabs)/mas') return appRoutes.mas;
  if (route === '/eventos') return appRoutes.eventos;
  if (route === '/permutas') return appRoutes.permutas;
  if (route === '/novedad') return appRoutes.novedad;
  if (route === '/credencial') return appRoutes.credencial;
  return appRoutes.alertas;
}

export default function AlertasScreen() {
  return (
    <RequireAuth>
      <AlertasScreenContent />
    </RequireAuth>
  );
}

function AlertasScreenContent() {
  const router = useRouter();
  const { user } = usePortalAuth();
  const { palette } = useTheme();
  const { items, loading, unreadCount, markRead, markAllUnreadRead } = usePortalInbox(user);
  const [testBusy, setTestBusy] = useState(false);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('Todas');

  const filtered = useMemo(() => {
    if (domainFilter === 'Todas') return items;
    return items.filter((n) => notificationDomainLabel(n.type) === domainFilter);
  }, [items, domainFilter]);

  const sendTestPush = useCallback(async () => {
    if (!user) return;
    setTestBusy(true);
    try {
      const callables = getPortalCallables();
      await callables.sendTestNotification({
        title: 'Prueba COSP Guardia',
        body: 'Si ves esto, FCM y la app nativa están alineados.',
      });
      Alert.alert('Enviada', 'Revisá la bandeja del sistema si la app está en segundo plano.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar la prueba';
      Alert.alert('Error', msg);
    } finally {
      setTestBusy(false);
    }
  }, [user]);

  const openInboxItem = useCallback(
    (n: PortalInboxItem) => {
      if (!n.read) void markRead(n.id);
      const route = routeFromNotificationData({
        type: n.type,
        solicitudId: n.solicitudId,
        eventoId: n.eventoId,
        shiftId: n.shiftId,
      });
      if (route) {
        router.push(hrefFromRoute(route));
      }
    },
    [markRead, router],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
              Push + historial in-app (planificación, operaciones, eventos, RRHH).
              {unreadCount > 0 ? ` · ${unreadCount} sin leer` : ''}
            </Text>
            <View style={styles.filters}>
              {DOMAIN_FILTERS.map((label) => {
                const active = domainFilter === label;
                return (
                  <Pressable
                    key={label}
                    onPress={() => setDomainFilter(label)}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: active ? palette.primary : palette.inputBg,
                        borderColor: active ? palette.primary : palette.cardBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterText,
                        { color: active ? palette.onPrimary : palette.onSurfaceMuted },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {__DEV__ ? (
              <CommandButton
                label={testBusy ? 'Enviando…' : 'Prueba FCM (dev)'}
                variant="secondary"
                onPress={sendTestPush}
                disabled={testBusy}
                style={styles.headerBtn}
              />
            ) : null}
            {unreadCount > 0 ? (
              <CommandButton
                label="Marcar todas leídas"
                variant="secondary"
                onPress={() => markAllUnreadRead()}
                style={styles.headerBtn}
              />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={palette.primary} style={styles.loader} />
          ) : (
            <CommandCard style={styles.emptyCard}>
              <Text style={[styles.emptyText, { color: palette.onSurfaceMuted }]}>
                {domainFilter === 'Todas'
                  ? 'Sin alertas por ahora. Cuando Operaciones o Planificación te avisen, aparecen acá y también como notificación del teléfono.'
                  : `Sin alertas en ${domainFilter}.`}
              </Text>
            </CommandCard>
          )
        }
        renderItem={({ item: n }) => (
          <View
            style={[
              styles.inboxItem,
              {
                backgroundColor: n.read ? palette.inputBg : palette.card,
                borderColor: n.read ? palette.cardBorder : palette.primary,
              },
            ]}
          >
            <View style={styles.inboxTop}>
              <Text style={[styles.domain, { color: palette.primary }]}>
                {notificationDomainLabel(n.type)}
              </Text>
              {!n.read ? (
                <Text style={[styles.nueva, { color: palette.error }]}>Nueva</Text>
              ) : null}
            </View>
            <Text style={[styles.inboxTitle, { color: palette.onSurface }]}>
              {n.title || 'Alerta'}
            </Text>
            {n.body ? (
              <Text style={[styles.inboxBody, { color: palette.onSurfaceMuted }]} numberOfLines={3}>
                {n.body}
              </Text>
            ) : null}
            {routeFromNotificationData({ type: n.type }) ? (
              <CommandButton
                label={notificationActionLabel(n.type)}
                variant="primary"
                onPress={() => openInboxItem(n)}
                style={styles.actionBtn}
              />
            ) : !n.read ? (
              <CommandButton
                label="Marcar leída"
                variant="secondary"
                onPress={() => markRead(n.id)}
                style={styles.actionBtn}
              />
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { padding: spacing.container, paddingBottom: 32, gap: 10 },
  headerBlock: { gap: 8, marginBottom: 8 },
  intro: { fontSize: 14, lineHeight: 21 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterText: { fontSize: 11, fontWeight: '800' },
  headerBtn: { marginTop: 0 },
  loader: { marginVertical: 32 },
  emptyCard: { marginTop: 12 },
  emptyText: { fontSize: 14, lineHeight: 21 },
  inboxItem: {
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  inboxTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  domain: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nueva: { fontSize: 11, fontWeight: '800' },
  inboxTitle: { fontWeight: '800', fontSize: 15 },
  inboxBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  actionBtn: { marginTop: 10 },
});

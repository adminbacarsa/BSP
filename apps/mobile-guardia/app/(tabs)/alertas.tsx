import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
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
  alertNeedsAck,
  notificationActionLabel,
  notificationDomainLabel,
  routeFromNotificationData,
} from '../../src/lib/notificationNavigation';
import { getPortalCallables } from '../../src/lib/portal';
import { appRoutes } from '../../src/lib/appRoutes';
import type { Href } from 'expo-router';

const DOMAIN_FILTERS = ['Todas', 'Planificación', 'Operaciones', 'Eventos', 'Permutas'] as const;
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
  const { user, previewEmpDocId, isPreviewMode } = usePortalAuth();
  const { palette } = useTheme();
  const { items, loading, unreadCount, markRead, acknowledge, dismiss, markAllUnreadRead, dismissAll } =
    usePortalInbox(user, previewEmpDocId);
  const [testBusy, setTestBusy] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [dismissAllBusy, setDismissAllBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('Todas');

  const filtered = useMemo(() => {
    if (domainFilter === 'Todas') return items;
    return items.filter((n) => notificationDomainLabel(n.type) === domainFilter);
  }, [items, domainFilter]);

  const pendingAck = useMemo(() => items.filter((n) => alertNeedsAck(n)).length, [items]);

  const sendTestPush = useCallback(async () => {
    if (!user) return;
    setTestBusy(true);
    try {
      const callables = getPortalCallables();
      const result = await callables.sendTestNotification({
        title: 'Prueba COSP Guardia',
        body: 'Si ves esto, FCM y la app nativa están alineados.',
        type: 'SYSTEM_TEST',
      });
      const data = (result?.data ?? {}) as { successCount?: number; failureCount?: number };
      const ok = Number(data.successCount || 0);
      const fail = Number(data.failureCount || 0);
      if (ok === 0) {
        Alert.alert(
          'Push no entregada',
          fail > 0
            ? `FCM rechazó ${fail} token(s). Cerrá sesión, volvé a entrar y reintentá.`
            : 'No hay tokens FCM para esta cuenta. Aceptá notificaciones y reabrí la app.',
        );
        return;
      }
      Alert.alert('Push enviada', `OK: ${ok}${fail ? ` · fallidas: ${fail}` : ''}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar la prueba';
      Alert.alert('Error', msg);
    } finally {
      setTestBusy(false);
    }
  }, [user]);

  const onMarkAll = useCallback(async () => {
    if (unreadCount === 0) return;
    setMarkAllBusy(true);
    try {
      await markAllUnreadRead();
      Alert.alert('Listo', 'Todas las alertas quedaron leídas y confirmadas.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudieron marcar todas.';
      Alert.alert('Error', msg);
    } finally {
      setMarkAllBusy(false);
    }
  }, [markAllUnreadRead, unreadCount]);

  const onDismissAll = useCallback(() => {
    if (items.length === 0) return;
    const pendingAckCount = items.filter((n) => alertNeedsAck(n)).length;
    Alert.alert(
      'Borrar todas',
      pendingAckCount > 0
        ? `Se van a quitar ${items.length} alerta(s). Las ${pendingAckCount} que pedían confirmación se marcarán como enteradas.`
        : `Se van a quitar ${items.length} alerta(s) de tu bandeja.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar todas',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDismissAllBusy(true);
              try {
                await dismissAll();
                Alert.alert('Listo', 'Bandeja vaciada.');
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'No se pudieron borrar todas.';
                Alert.alert('Error', msg);
              } finally {
                setDismissAllBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [dismissAll, items]);

  const headerBusy = markAllBusy || dismissAllBusy || testBusy;

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

  const onAck = useCallback(
    async (n: PortalInboxItem) => {
      setBusyId(n.id);
      try {
        await acknowledge(n.id);
      } catch {
        Alert.alert('Error', 'No se pudo registrar el acuse. Reintentá.');
      } finally {
        setBusyId(null);
      }
    },
    [acknowledge],
  );

  const onDismiss = useCallback(
    (n: PortalInboxItem) => {
      const needsAck = alertNeedsAck(n);
      Alert.alert(
        'Quitar alerta',
        needsAck
          ? 'Este aviso pide confirmación. ¿Marcar como enterado y quitarlo?'
          : 'Se oculta de tu bandeja (queda el acuse en el historial del sistema).',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: needsAck ? 'Enterado y quitar' : 'Quitar',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setBusyId(n.id);
                try {
                  if (needsAck) await acknowledge(n.id);
                  await dismiss(n.id);
                } catch {
                  Alert.alert('Error', 'No se pudo quitar la alerta.');
                } finally {
                  setBusyId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [acknowledge, dismiss],
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
              Avisos para vos: turnos, eventos y permutas.
              {unreadCount > 0 ? ` · ${unreadCount} sin leer` : ''}
              {pendingAck > 0 ? ` · ${pendingAck} por confirmar` : ''}
            </Text>
            {isPreviewMode ? (
              <Text style={[styles.fcmHint, { color: palette.warning }]}>
                Preview: alertas del legajo elegido. Salí y volvé a entrar al preview para atar el
                push FCM a ese legajo.
              </Text>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filtersRow}
              style={styles.filtersScroll}
            >
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
            </ScrollView>
            <View style={styles.headerActions}>
              {unreadCount > 0 ? (
                <CommandButton
                  label={markAllBusy ? 'Marcando…' : 'Marcar todas leídas'}
                  variant="secondary"
                  onPress={() => void onMarkAll()}
                  disabled={headerBusy}
                  style={styles.headerBtnFlex}
                />
              ) : null}
              {items.length > 0 ? (
                <CommandButton
                  label={dismissAllBusy ? 'Borrando…' : 'Borrar todas'}
                  variant="ghost"
                  onPress={onDismissAll}
                  disabled={headerBusy}
                  style={styles.headerBtnFlex}
                />
              ) : null}
              <CommandButton
                label={testBusy ? 'Enviando…' : 'Probar push'}
                variant="ghost"
                onPress={sendTestPush}
                disabled={headerBusy}
                style={styles.headerBtnFlex}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={palette.primary} style={styles.loader} />
          ) : (
            <CommandCard style={styles.emptyCard}>
              <Text style={[styles.emptyText, { color: palette.onSurfaceMuted }]}>
                {domainFilter === 'Todas'
                  ? 'Sin alertas. Cuando publiquen tu malla o te cambien un turno, aparecen acá.'
                  : `Sin alertas en ${domainFilter}.`}
              </Text>
            </CommandCard>
          )
        }
        renderItem={({ item: n }) => {
          const needsAck = alertNeedsAck(n);
          const busy = busyId === n.id;
          const route = routeFromNotificationData({ type: n.type });
          const settled = !needsAck && (n.read || !!n.ackedAt);

          if (settled) {
            return (
              <View
                style={[
                  styles.inboxItemCompact,
                  {
                    backgroundColor: palette.inputBg,
                    borderColor: palette.cardBorder,
                  },
                ]}
              >
                <View style={styles.compactTextCol}>
                  <Text style={[styles.domain, { color: palette.onSurfaceMuted }]}>
                    {notificationDomainLabel(n.type)}
                    {n.ackedAt ? ' · Enterado' : ' · Leída'}
                  </Text>
                  <Text
                    style={[styles.inboxTitleCompact, { color: palette.onSurface }]}
                    numberOfLines={1}
                  >
                    {n.title || 'Alerta'}
                  </Text>
                </View>
                <CommandButton
                  label={busy ? '…' : 'Quitar'}
                  variant="ghost"
                  onPress={() => onDismiss(n)}
                  disabled={busy}
                  style={styles.quitarCompact}
                />
              </View>
            );
          }

          return (
            <View
              style={[
                styles.inboxItem,
                {
                  backgroundColor: palette.card,
                  borderColor: needsAck ? palette.warning : palette.primary,
                },
              ]}
            >
              <View style={styles.inboxTop}>
                <Text style={[styles.domain, { color: palette.primary }]}>
                  {notificationDomainLabel(n.type)}
                </Text>
                {needsAck ? (
                  <Text style={[styles.nueva, { color: palette.warning }]}>Confirmar</Text>
                ) : (
                  <Text style={[styles.nueva, { color: palette.error }]}>Nueva</Text>
                )}
              </View>
              <Text style={[styles.inboxTitle, { color: palette.onSurface }]}>
                {n.title || 'Alerta'}
              </Text>
              {n.body ? (
                <Text style={[styles.inboxBody, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
                  {n.body}
                </Text>
              ) : null}
              <View style={styles.rowBtns}>
                {needsAck ? (
                  <CommandButton
                    label={busy ? '…' : 'Me enteré'}
                    variant="success"
                    onPress={() => void onAck(n)}
                    disabled={busy}
                    style={styles.btnFlex}
                  />
                ) : null}
                {route ? (
                  <CommandButton
                    label={notificationActionLabel(n.type)}
                    variant="secondary"
                    onPress={() => openInboxItem(n)}
                    disabled={busy}
                    style={styles.btnFlex}
                  />
                ) : null}
                <CommandButton
                  label="Quitar"
                  variant="ghost"
                  onPress={() => onDismiss(n)}
                  disabled={busy}
                  style={styles.btnFlex}
                />
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { padding: spacing.container, paddingBottom: 32, gap: 10 },
  headerBlock: { gap: 8, marginBottom: 8 },
  intro: { fontSize: 14, lineHeight: 21 },
  filtersScroll: { flexGrow: 0, marginHorizontal: -2 },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingRight: 8,
  },
  filterChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  filterText: { fontSize: 11, fontWeight: '800' },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  headerBtnFlex: { flexGrow: 1, minWidth: '40%' },
  fcmHint: { fontSize: 12, lineHeight: 17 },
  loader: { marginVertical: 32 },
  emptyCard: { marginTop: 12 },
  emptyText: { fontSize: 14, lineHeight: 21 },
  inboxItem: {
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  inboxItemCompact: {
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactTextCol: { flex: 1, minWidth: 0 },
  quitarCompact: { flexGrow: 0, flexShrink: 0, minWidth: 88, paddingHorizontal: 10 },
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
  inboxTitleCompact: { fontWeight: '700', fontSize: 13, marginTop: 2 },
  inboxBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  btnFlex: { flexGrow: 1, flexBasis: '45%', minWidth: 120 },
});

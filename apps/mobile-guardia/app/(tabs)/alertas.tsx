import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { radius, spacing } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';
import { usePortalInbox, type PortalInboxItem } from '../../src/hooks/usePortalInbox';
import {
  alertNeedsAck,
  notificationActionLabel,
  notificationDomainLabel,
  routeFromNotificationData,
  COVERAGE_RESPONSE_TYPES,
} from '../../src/lib/notificationNavigation';
import { getPortalCallables, isEmulatorMode } from '../../src/lib/portal';
import { appRoutes } from '../../src/lib/appRoutes';
import type { Href } from 'expo-router';
import { formatDateTimeAr, portalInboxDetailLines, toDate } from '@cosp/portal-core';
import { appAlert } from '@/lib/appAlert';
import { ALERTAS_PAGE_SIZE, paginateAlertItems } from '../../src/lib/alertasPagination';

const DOMAIN_FILTERS = ['Todas', 'Cobertura', 'Planificación', 'Operaciones', 'Eventos', 'Permutas'] as const;
type DomainFilter = (typeof DOMAIN_FILTERS)[number];

function formatShiftWindow(n: PortalInboxItem): string | null {
  const start = n.startTime ? toDate(n.startTime as never) : null;
  const end = n.endTime ? toDate(n.endTime as never) : null;
  if (!start && !n.shiftCode) return null;
  const parts: string[] = [];
  if (n.shiftCode) parts.push(`Código ${n.shiftCode}`);
  if (start) {
    const day = start.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const hi = start.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    const hf = end
      ? end.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Argentina/Buenos_Aires',
        })
      : '';
    parts.push(hf ? `${day} ${hi}–${hf}` : `${day} ${hi}`);
  }
  return parts.join(' · ');
}

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
  const { user, previewEmpDocId, isPreviewMode, isSuperAdmin } = usePortalAuth();
  const { palette } = useTheme();
  const { contentMaxWidth, horizontalPadding, isCompact } = useResponsiveLayout();
  const { items, loading, unreadCount, markRead, acknowledge, respond, dismiss, markAllUnreadRead, dismissAll } =
    usePortalInbox(user, previewEmpDocId);
  const showTestPush = isEmulatorMode() || isPreviewMode || isSuperAdmin;
  const [testBusy, setTestBusy] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [dismissAllBusy, setDismissAllBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('Todas');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (domainFilter === 'Todas') return items;
    return items.filter((n) => notificationDomainLabel(n.type) === domainFilter);
  }, [items, domainFilter]);

  const { pageItems, safePage, totalPages, from, to, total } = useMemo(
    () => paginateAlertItems(filtered, page),
    [filtered, page],
  );

  const pageRangeLabel =
    total === 0 ? '0 de 0' : `${from}–${to} de ${total}`;

  useEffect(() => {
    setPage(0);
  }, [domainFilter]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

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
        appAlert(
          'Push no entregada',
          fail > 0
            ? `FCM rechazó ${fail} token(s). Cerrá sesión, volvé a entrar y reintentá.`
            : 'No hay tokens FCM para esta cuenta. Aceptá notificaciones y reabrí la app.',
        );
        return;
      }
      appAlert('Push enviada', `OK: ${ok}${fail ? ` · fallidas: ${fail}` : ''}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar la prueba';
      appAlert('Error', msg);
    } finally {
      setTestBusy(false);
    }
  }, [user]);

  const onMarkAll = useCallback(async () => {
    if (unreadCount === 0) return;
    setMarkAllBusy(true);
    try {
      await markAllUnreadRead();
      appAlert('Listo', 'Todas las alertas quedaron leídas y confirmadas.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudieron marcar todas.';
      appAlert('Error', msg);
    } finally {
      setMarkAllBusy(false);
    }
  }, [markAllUnreadRead, unreadCount]);

  const onDismissAll = useCallback(() => {
    if (items.length === 0) return;
    const pendingAckCount = items.filter((n) => alertNeedsAck(n)).length;
    appAlert(
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
                appAlert('Listo', 'Bandeja vaciada.');
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'No se pudieron borrar todas.';
                appAlert('Error', msg);
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
        appAlert('Error', 'No se pudo registrar el acuse. Reintentá.');
      } finally {
        setBusyId(null);
      }
    },
    [acknowledge],
  );

  const onRespond = useCallback(
    (n: PortalInboxItem, response: 'ACCEPTED' | 'REJECTED') => {
      const label = response === 'ACCEPTED' ? 'Aceptar' : 'Rechazar';
      appAlert(
        label,
        response === 'ACCEPTED'
          ? '¿Confirmás que aceptás la cobertura?'
          : '¿Confirmás que rechazás la cobertura?',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: label,
            style: response === 'ACCEPTED' ? 'default' : 'destructive',
            onPress: () => {
              void (async () => {
                setBusyId(n.id);
                try {
                  await respond(n.id, response);
                } catch {
                  appAlert('Error', 'No se pudo enviar la respuesta. Reintentá.');
                } finally {
                  setBusyId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [respond],
  );

  const onDismiss = useCallback(
    (n: PortalInboxItem) => {
      const needsAck = alertNeedsAck(n);
      appAlert(
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
                  appAlert('Error', 'No se pudo quitar la alerta.');
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
        data={pageItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          {
            paddingHorizontal: horizontalPadding,
            ...(contentMaxWidth
              ? { maxWidth: contentMaxWidth, alignSelf: 'center' as const, width: '100%' }
              : {}),
          },
        ]}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
              Avisos para vos: turnos, eventos y permutas.
              {unreadCount > 0 ? ` · ${unreadCount} sin leer` : ''}
              {pendingAck > 0 ? ` · ${pendingAck} por confirmar` : ''}
            </Text>
            {isPreviewMode ? (
              <Text style={[styles.fcmHint, { color: palette.warning }]}>
                Preview: alertas del legajo elegido. En web tocá «Activar notificaciones» en el banner
                naranja para atar el push FCM a este dispositivo.
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
              {showTestPush ? (
                <CommandButton
                  label={testBusy ? 'Enviando…' : 'Probar push'}
                  variant="ghost"
                  onPress={sendTestPush}
                  disabled={headerBusy}
                  style={styles.headerBtnFlex}
                />
              ) : null}
            </View>
          </View>
        }
        ListFooterComponent={
          total > ALERTAS_PAGE_SIZE ? (
            <View
              style={[
                styles.pager,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.cardBorder,
                },
              ]}
            >
              <CommandButton
                label="Atrás"
                variant="ghost"
                onPress={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage <= 0}
                style={styles.pagerBtn}
              />
              <Text style={[styles.pagerLabel, { color: palette.onSurfaceMuted }]}>
                {pageRangeLabel}
                {'\n'}
                <Text style={{ fontWeight: '800', color: palette.onSurface }}>
                  Página {safePage + 1} / {totalPages}
                </Text>
              </Text>
              <CommandButton
                label="Adelante"
                variant="secondary"
                onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                style={styles.pagerBtn}
              />
            </View>
          ) : total > 0 ? (
            <Text style={[styles.pagerHint, { color: palette.onSurfaceMuted }]}>{pageRangeLabel}</Text>
          ) : null
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
          const isCoverage = COVERAGE_RESPONSE_TYPES.has(String(n.type ?? '').toUpperCase());
          const busy = busyId === n.id;
          const route = routeFromNotificationData({ type: n.type });
          const settled = !needsAck && !isCoverage && (n.read || !!n.ackedAt);
          const receivedAt = n.createdAt ? formatDateTimeAr(n.createdAt as never) : '';
          const detailLines = portalInboxDetailLines(n);
          const shiftWindow = formatShiftWindow(n);

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
                  {receivedAt ? (
                    <Text style={[styles.metaLine, { color: palette.onSurfaceMuted }]} numberOfLines={1}>
                      Recibida {receivedAt}
                    </Text>
                  ) : null}
                  {detailLines[0] ? (
                    <Text style={[styles.metaLine, { color: palette.onSurfaceMuted }]} numberOfLines={1}>
                      {detailLines[0]}
                    </Text>
                  ) : null}
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
                <Text style={[styles.domain, { color: isCoverage ? palette.error : palette.primary }]}>
                  {notificationDomainLabel(n.type)}
                </Text>
                {isCoverage ? (
                  <Text style={[styles.nueva, { color: palette.error }]}>Responder</Text>
                ) : needsAck ? (
                  <Text style={[styles.nueva, { color: palette.warning }]}>Confirmar</Text>
                ) : (
                  <Text style={[styles.nueva, { color: palette.error }]}>Nueva</Text>
                )}
              </View>
              {receivedAt ? (
                <Text style={[styles.receivedAt, { color: palette.onSurfaceMuted }]}>
                  Recibida {receivedAt}
                </Text>
              ) : null}
              <Text style={[styles.inboxTitle, { color: palette.onSurface }]}>
                {n.title || 'Alerta'}
              </Text>
              {n.body ? (
                <Text style={[styles.inboxBody, { color: palette.onSurfaceMuted }]} numberOfLines={4}>
                  {n.body}
                </Text>
              ) : null}
              {detailLines.length > 0 || shiftWindow ? (
                <View style={[styles.detailBox, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
                  {detailLines.map((line) => (
                    <Text key={line} style={[styles.detailLine, { color: palette.onSurface }]}>
                      {line}
                    </Text>
                  ))}
                  {shiftWindow ? (
                    <Text style={[styles.detailLine, { color: palette.onSurface }]}>{shiftWindow}</Text>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.rowBtns}>
                {isCoverage ? (
                  <>
                    <CommandButton
                      label={busy ? '…' : 'Aceptar'}
                      variant="success"
                      onPress={() => onRespond(n, 'ACCEPTED')}
                      disabled={busy}
                      style={styles.btnFlex}
                    />
                    <CommandButton
                      label={busy ? '…' : 'Rechazar'}
                      variant="danger"
                      onPress={() => onRespond(n, 'REJECTED')}
                      disabled={busy}
                      style={styles.btnFlex}
                    />
                  </>
                ) : needsAck ? (
                  <CommandButton
                    label={busy ? '…' : 'Me enteré'}
                    variant="success"
                    onPress={() => void onAck(n)}
                    disabled={busy}
                    style={styles.btnFlex}
                  />
                ) : null}
                {!isCoverage && route ? (
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
  list: { paddingVertical: spacing.container, paddingBottom: 32, gap: 10 },
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
  pager: {
    marginTop: 8,
    marginBottom: 16,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pagerBtn: { flexGrow: 0, minWidth: 96 },
  pagerLabel: { flex: 1, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  pagerHint: { textAlign: 'center', fontSize: 12, marginTop: 4, marginBottom: 12 },
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
  receivedAt: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  metaLine: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  detailBox: {
    marginTop: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  detailLine: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  btnFlex: { flexGrow: 1, flexBasis: '45%', minWidth: 120 },
});

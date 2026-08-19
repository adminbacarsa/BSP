import { ActivityIndicator, FlatList, Linking, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDateAr, formatTimeAr, isEvShift, resolveEvShiftDisplay } from '@cosp/portal-core';
import type { Evento, Shift } from '@cosp/portal-types';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { useEventosMap } from '../src/hooks/useEventosMap';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { radius, shadow } from '../src/theme/tokens';
import { PortalErrorPanel } from '../src/components/PortalErrorPanel';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';
import { useTheme } from '../src/theme/ThemeContext';

function ShiftRow({ item, eventosMap }: { item: Shift; eventosMap: Record<string, Evento> }) {
  const { palette } = useTheme();
  const isFranco = item.isFranco;
  const ev = resolveEvShiftDisplay(item, eventosMap);
  const isEv = isEvShift(item);

  const title = isFranco
    ? 'Franco'
    : ev?.nombre || item.objectiveName || item.clientName || 'Turno asignado';

  const timeLine = isFranco
    ? `${formatDateAr(item.startTime)}`
    : ev?.horarioBadge
      ? `${formatDateAr(item.startTime)} · ${ev.horarioBadge}`
      : `${formatDateAr(item.startTime)} · ${formatTimeAr(item.startTime)} – ${formatTimeAr(item.endTime)}`;

  return (
    <View
      style={[
        styles.row,
        palette.useCardShadow && shadow.card,
        {
          backgroundColor: isEv ? palette.inputBg : palette.card,
          borderColor: isEv ? palette.warning : palette.cardBorder,
        },
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: isEv ? palette.warning : palette.primary }]} />
      <View style={[styles.codeBox, isEv ? styles.codeEv : null]}>
        <Text style={[styles.codeText, isEv ? { color: palette.warning } : { color: palette.primary }]}>
          {isFranco ? 'F' : isEv ? 'EV' : String(item.code || 'T').toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: isEv ? palette.onSurface : palette.onSurface }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: palette.onSurfaceMuted }]}>{timeLine}</Text>
        {ev?.eventoNombre && ev.eventoNombre !== ev.nombre ? (
          <Text style={[styles.rowMeta, { color: palette.warning }]}>{ev.eventoNombre}</Text>
        ) : item.positionName ? (
          <Text style={[styles.rowMeta, { color: palette.primary }]}>{item.positionName}</Text>
        ) : null}
        {ev?.clienteNombre ? (
          <Text style={[styles.rowMeta, { color: palette.onSurfaceMuted }]}>{ev.clienteNombre}</Text>
        ) : null}
        {ev?.direccion ? (
          <Text style={[styles.rowAddr, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
            {ev.direccion}
          </Text>
        ) : null}
        {ev?.mapsUrl ? (
          <CommandButton
            label="Cómo llegar"
            variant="ghost"
            onPress={() => void Linking.openURL(ev.mapsUrl!)}
            style={styles.mapsBtn}
          />
        ) : null}
      </View>
      {item.isPresent ? (
        <View style={styles.badgeOk}>
          <Text style={styles.badgeOkText}>Presente</Text>
        </View>
      ) : isFranco ? (
        <View style={styles.badgeFranco}>
          <Text style={styles.badgeFrancoText}>Libre</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AgendaScreen() {
  return (
    <RequireAuth>
      <AgendaScreenContent />
    </RequireAuth>
  );
}

function AgendaScreenContent() {
  const { empDocId, portalFeatures, user, employee } = usePortalAuth();
  const { shifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { eventosMap, loading: eventosLoading } = useEventosMap(employee?.empresaId);
  const { palette } = useTheme();
  const { isOffline } = useNetworkStatus();

  if (!portalFeatures.viewSchedule) {
    return (
      <>
        <Stack.Screen options={{ title: 'Agenda' }} />
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
          <CommandCard style={styles.centerCard}>
            <Text style={styles.disabled}>La agenda no está habilitada para tu empresa.</Text>
          </CommandCard>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Cronograma' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        {loading ? (
          <ActivityIndicator size="large" color={palette.primary} style={styles.loader} />
        ) : error ? (
          <PortalErrorPanel
            title="Agenda"
            message={
              isOffline
                ? 'Sin conexión. Los turnos en pantalla pueden estar desactualizados hasta que vuelva la red.'
                : error
            }
          />
        ) : (
          <FlatList
            data={shifts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <Text style={[styles.header, { color: palette.primary }]}>
                Turnos del mes · tiempo real
                {eventosLoading ? '' : ''}
              </Text>
            }
            ListEmptyComponent={
              <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>Sin turnos en el mes actual.</Text>
            }
            renderItem={({ item }) => <ShiftRow item={item} eventosMap={eventosMap} />}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { padding: 20, paddingBottom: 32, gap: 12 },
  header: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.lg,
    marginBottom: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rowAccent: { width: 4 },
  codeBox: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  codeEv: {},
  codeText: { fontWeight: '900', fontSize: 11 },
  rowBody: { flex: 1, paddingVertical: 14, paddingRight: 8, gap: 4 },
  rowTitle: { fontWeight: '800', fontSize: 16 },
  rowSub: { fontSize: 13, fontWeight: '600' },
  rowMeta: { fontSize: 12, fontWeight: '700' },
  rowAddr: { fontSize: 12, lineHeight: 17 },
  mapsBtn: { alignSelf: 'flex-start', marginTop: 2 },
  badgeOk: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#d1fae5',
  },
  badgeOkText: { fontWeight: '800', fontSize: 11 },
  badgeFranco: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeFrancoText: { fontWeight: '800', fontSize: 11 },
  loader: { marginTop: 48 },
  centerCard: { margin: 20 },
  empty: { textAlign: 'center', padding: 24 },
  disabled: { textAlign: 'center' },
});

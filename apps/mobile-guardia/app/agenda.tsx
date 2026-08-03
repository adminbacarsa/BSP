import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDateAr, formatTimeAr } from '@cosp/portal-core';
import type { Shift } from '@cosp/portal-types';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { radius, shadow } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

function ShiftRow({ item }: { item: Shift }) {
  const { palette } = useTheme();
  const isFranco = item.isFranco;
  return (
    <View
      style={[
        styles.row,
        palette.useCardShadow && shadow.card,
        { backgroundColor: palette.card, borderColor: palette.cardBorder },
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: palette.primary }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: palette.onSurface }]}>
          {isFranco ? 'Franco' : item.objectiveName || item.clientName || 'Turno asignado'}
        </Text>
        <Text style={[styles.rowSub, { color: palette.onSurfaceMuted }]}>
          {formatDateAr(item.startTime)} · {formatTimeAr(item.startTime)} – {formatTimeAr(item.endTime)}
        </Text>
        {item.positionName ? (
          <Text style={[styles.rowMeta, { color: palette.primary }]}>{item.positionName}</Text>
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
  const { empDocId, portalFeatures, user } = usePortalAuth();
  const { shifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { palette } = useTheme();

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
          <CommandCard style={styles.centerCard}>
            <Text style={styles.error}>{error}</Text>
          </CommandCard>
        ) : (
          <FlatList
            data={shifts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <Text style={[styles.header, { color: palette.primary }]}>Turnos del mes · tiempo real</Text>
            }
            ListEmptyComponent={
              <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>Sin turnos en el mes actual.</Text>
            }
            renderItem={({ item }) => <ShiftRow item={item} />}
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
  rowBody: { flex: 1, padding: 16, gap: 4 },
  rowTitle: { fontWeight: '800', fontSize: 16 },
  rowSub: { fontSize: 13, fontWeight: '600' },
  rowMeta: { fontSize: 12, fontWeight: '700' },
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
  error: { fontSize: 14 },
  disabled: { textAlign: 'center' },
});

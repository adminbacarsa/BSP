import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDateAr, formatTimeAr } from '@cosp/portal-core';
import type { Shift } from '@cosp/portal-types';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { CommandCard } from '../src/components/ui/CommandCard';
import { colors, radius, shadow } from '../src/theme/tokens';

function ShiftRow({ item }: { item: Shift }) {
  const isFranco = item.isFranco;
  return (
    <View style={[styles.row, shadow.card]}>
      <View style={styles.rowAccent} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>
          {isFranco ? 'Franco' : item.objectiveName || item.clientName || 'Turno asignado'}
        </Text>
        <Text style={styles.rowSub}>
          {formatDateAr(item.startTime)} · {formatTimeAr(item.startTime)} – {formatTimeAr(item.endTime)}
        </Text>
        {item.positionName ? <Text style={styles.rowMeta}>{item.positionName}</Text> : null}
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
  const { empDocId, portalFeatures, user } = usePortalAuth();
  const { shifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);

  if (!portalFeatures.viewSchedule) {
    return (
      <>
        <Stack.Screen options={{ title: 'Agenda' }} />
        <SafeAreaView style={styles.safe}>
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
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.indigo600} style={styles.loader} />
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
              <Text style={styles.header}>Turnos del mes · tiempo real</Text>
            }
            ListEmptyComponent={<Text style={styles.empty}>Sin turnos en el mes actual.</Text>}
            renderItem={({ item }) => <ShiftRow item={item} />}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.slate50 },
  list: { padding: 20, paddingBottom: 32, gap: 12 },
  header: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.indigo600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.slate200,
    overflow: 'hidden',
  },
  rowAccent: { width: 4, backgroundColor: colors.indigo600 },
  rowBody: { flex: 1, padding: 16, gap: 4 },
  rowTitle: { fontWeight: '800', color: colors.slate950, fontSize: 16 },
  rowSub: { color: colors.slate500, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: colors.indigo600, fontSize: 12, fontWeight: '700' },
  badgeOk: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#d1fae5',
  },
  badgeOkText: { color: colors.emerald600, fontWeight: '800', fontSize: 11 },
  badgeFranco: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.indigo100,
  },
  badgeFrancoText: { color: colors.indigo800, fontWeight: '800', fontSize: 11 },
  loader: { marginTop: 48 },
  centerCard: { margin: 20 },
  empty: { textAlign: 'center', color: colors.slate500, padding: 24 },
  error: { color: colors.amber600 },
  disabled: { color: colors.slate500, textAlign: 'center' },
});

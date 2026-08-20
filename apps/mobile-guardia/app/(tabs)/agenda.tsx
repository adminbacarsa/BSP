import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Shift } from '@cosp/portal-types';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../../src/hooks/useEmployeeShifts';
import { useEventosMap } from '../../src/hooks/useEventosMap';
import { useObjectivesMap } from '../../src/hooks/useObjectivesMap';
import {
  addDays,
  addMonths,
  buildMonthCells,
  formatDayTitle,
  formatMonthTitle,
  formatWeekRangeTitle,
  groupShiftsByDateKey,
  parseDateKey,
  shiftsForDateKey,
  startOfWeekMonday,
  toDateKey,
  weekDaysFrom,
  type AgendaViewMode,
} from '../../src/lib/agendaCalendar';
import { AgendaViewSwitcher } from '../../src/components/agenda/AgendaViewSwitcher';
import { AgendaMonthGrid } from '../../src/components/agenda/AgendaMonthGrid';
import { AgendaWeekStrip } from '../../src/components/agenda/AgendaWeekStrip';
import {
  AgendaEmptyDay,
  AgendaPeriodNav,
  AgendaShiftCard,
} from '../../src/components/agenda/AgendaShiftCard';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { spacing } from '../../src/theme/tokens';
import { PortalErrorPanel } from '../../src/components/PortalErrorPanel';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useTheme } from '../../src/theme/ThemeContext';

export default function AgendaScreen() {
  return (
    <RequireAuth>
      <AgendaScreenContent />
    </RequireAuth>
  );
}

function AgendaScreenContent() {
  const { empDocId, portalFeatures, user, employee } = usePortalAuth();
  const { palette } = useTheme();
  const { isOffline } = useNetworkStatus();

  const [mode, setMode] = useState<AgendaViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const selectedKey = toDateKey(cursor);
  const monthAnchor = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    [cursor.getFullYear(), cursor.getMonth()],
  );

  const { shifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null, monthAnchor);
  const { objectivesMap } = useObjectivesMap();
  const { eventosMap } = useEventosMap(employee?.empresaId);

  const byDay = useMemo(() => groupShiftsByDateKey(shifts), [shifts]);
  const monthCells = useMemo(() => buildMonthCells(monthAnchor, byDay), [monthAnchor, byDay]);
  const cellsByKey = useMemo(() => {
    const map: Record<string, (typeof monthCells)[number]> = {};
    for (const c of monthCells) map[c.key] = c;
    return map;
  }, [monthCells]);

  const weekDays = useMemo(() => weekDaysFrom(cursor), [selectedKey]);
  const dayShifts: Shift[] = shiftsForDateKey(byDay, selectedKey);

  const periodTitle =
    mode === 'month'
      ? formatMonthTitle(monthAnchor)
      : mode === 'week'
        ? formatWeekRangeTitle(startOfWeekMonday(cursor))
        : formatDayTitle(cursor);

  function selectDayKey(key: string) {
    const next = parseDateKey(key);
    setCursor(next);
    if (mode === 'month') {
      /* se queda en mes; lista debajo muestra el día */
    }
  }

  function goPrev() {
    if (mode === 'month') {
      const nextMonth = addMonths(monthAnchor, -1);
      setCursor(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
      return;
    }
    if (mode === 'week') {
      setCursor(addDays(cursor, -7));
      return;
    }
    setCursor(addDays(cursor, -1));
  }

  function goNext() {
    if (mode === 'month') {
      const nextMonth = addMonths(monthAnchor, 1);
      setCursor(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
      return;
    }
    if (mode === 'week') {
      setCursor(addDays(cursor, 7));
      return;
    }
    setCursor(addDays(cursor, 1));
  }

  function goToday() {
    setCursor(new Date());
  }

  function onChangeMode(next: AgendaViewMode) {
    setMode(next);
  }

  if (!portalFeatures.viewSchedule) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
        <CommandCard style={styles.centerCard}>
          <Text style={[styles.disabled, { color: palette.onSurfaceMuted }]}>
            La agenda no está habilitada para tu empresa.
          </Text>
        </CommandCard>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
      {error && !loading ? (
        <PortalErrorPanel
          title="Agenda"
          message={
            isOffline
              ? 'Sin conexión. Los turnos en pantalla pueden estar desactualizados hasta que vuelva la red.'
              : error
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <AgendaViewSwitcher mode={mode} onChange={onChangeMode} />
          <AgendaPeriodNav title={periodTitle} onPrev={goPrev} onNext={goNext} onToday={goToday} />

          {loading ? (
            <ActivityIndicator size="large" color={palette.primary} style={styles.loader} />
          ) : (
            <>
              {mode === 'month' ? (
                <AgendaMonthGrid
                  cells={monthCells}
                  selectedKey={selectedKey}
                  onSelectDay={selectDayKey}
                />
              ) : null}

              {mode === 'week' ? (
                <AgendaWeekStrip
                  days={weekDays}
                  cellsByKey={cellsByKey}
                  selectedKey={selectedKey}
                  onSelectDay={selectDayKey}
                />
              ) : null}

              <Text style={[styles.daySection, { color: palette.primary }]}>
                {mode === 'day' ? 'Detalle del día' : `Turnos · ${formatDayTitle(cursor)}`}
              </Text>

              {dayShifts.length === 0 ? (
                <AgendaEmptyDay message="Sin turnos ni francos en este día." />
              ) : (
                dayShifts.map((item) => (
                  <AgendaShiftCard
                    key={item.id}
                    item={item}
                    eventosMap={eventosMap}
                    objectivesMap={objectivesMap}
                  />
                ))
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, paddingBottom: 32, gap: 12 },
  centerCard: { margin: 20 },
  disabled: { textAlign: 'center' },
  loader: { marginVertical: 40 },
  daySection: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
  },
});

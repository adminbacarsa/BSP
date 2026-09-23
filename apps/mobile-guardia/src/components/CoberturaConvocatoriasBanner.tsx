import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatTimeAr, toDate } from '@cosp/portal-core';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import {
  convocatoriaCoberturaTypeLabel,
  type ConvocatoriaCobertura,
} from '../lib/convocatoriasCobertura';

type Props = {
  convocatorias: ConvocatoriaCobertura[];
  busyId?: string | null;
  highlightedId?: string | null;
  onAccept: (c: ConvocatoriaCobertura) => void;
  onReject: (c: ConvocatoriaCobertura) => void;
};

function remainingLabel(timeoutAt: ConvocatoriaCobertura['timeoutAt'], now: Date): string {
  const end = toDate(timeoutAt);
  if (!end) return '';
  const sec = Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0 && s <= 0) return 'Tiempo agotado (aún podés responder)';
  if (m <= 0) return `${s}s restantes`;
  return `${m}:${String(s).padStart(2, '0')} restantes`;
}

export function CoberturaConvocatoriasBanner({
  convocatorias,
  busyId,
  highlightedId,
  onAccept,
  onReject,
}: Props) {
  const { palette } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const list = useMemo(() => convocatorias, [convocatorias]);
  if (list.length === 0) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: palette.card,
          borderColor: palette.primary,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: palette.primary }]}>Cobertura</Text>
        <View style={[styles.countPill, { backgroundColor: palette.primary }]}>
          <Text style={styles.countText}>{list.length}</Text>
        </View>
      </View>

      {list.map((c) => {
        const busy = busyId === c.id;
        const typeLabel = convocatoriaCoberturaTypeLabel(c.type);
        const obj = (c.objectiveName || c.clientName || 'Objetivo').trim();
        const start = formatTimeAr(c.startTime);
        const end = c.endTime ? formatTimeAr(c.endTime) : '';
        const horario = start && end ? `${start} – ${end}` : start || 'Horario a confirmar';
        const remain = remainingLabel(c.timeoutAt, now);
        const highlight = highlightedId === c.id;

        return (
          <View
            key={c.id}
            style={[
              styles.item,
              {
                borderColor: highlight ? palette.primary : palette.cardBorder,
                backgroundColor: highlight ? 'rgba(79, 70, 229, 0.08)' : palette.inputBg,
              },
            ]}
          >
            <View style={styles.typeRow}>
              <View style={[styles.typePill, { backgroundColor: palette.primary }]}>
                <Text style={styles.typePillText}>{typeLabel}</Text>
              </View>
              {remain ? (
                <Text style={[styles.remain, { color: palette.warning }]}>{remain}</Text>
              ) : null}
            </View>
            <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={2}>
              {obj}
            </Text>
            <Text style={[styles.sub, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
              {c.positionName ? `${c.positionName} · ` : ''}
              {horario}
              {c.shiftCode ? ` · ${String(c.shiftCode).toUpperCase()}` : ''}
            </Text>
            <View style={styles.rowBtns}>
              <CommandButton
                label="Acepto"
                variant="success"
                onPress={() => onAccept(c)}
                disabled={busy}
                loading={busy}
                style={styles.btnFlex}
              />
              <CommandButton
                label="No puedo"
                variant="secondary"
                onPress={() => onReject(c)}
                disabled={busy}
                style={styles.btnFlex}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  item: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 6,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  typePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  remain: {
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnFlex: {
    flex: 1,
  },
});

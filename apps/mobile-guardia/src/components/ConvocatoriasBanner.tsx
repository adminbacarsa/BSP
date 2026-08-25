import { StyleSheet, Text, View } from 'react-native';
import type { SolicitudEvento } from '@cosp/portal-types';
import { formatDateAr } from '@cosp/portal-core';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  convocatorias: SolicitudEvento[];
  busyId?: string | null;
  onAccept: (sol: SolicitudEvento) => void;
  onReject: (sol: SolicitudEvento) => void;
};

export function ConvocatoriasBanner({ convocatorias, busyId, onAccept, onReject }: Props) {
  const { palette } = useTheme();
  if (convocatorias.length === 0) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: palette.card,
          borderColor: palette.warning,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: palette.warning }]}>Convocatorias</Text>
        <View style={[styles.countPill, { backgroundColor: palette.warning }]}>
          <Text style={styles.countText}>{convocatorias.length}</Text>
        </View>
      </View>

      {convocatorias.map((sol) => {
        const busy = busyId === sol.id;
        return (
          <View
            key={sol.id}
            style={[styles.item, { borderColor: palette.cardBorder, backgroundColor: palette.inputBg }]}
          >
            <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={2}>
              {sol.eventoNombre}
            </Text>
            <Text style={[styles.sub, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
              {sol.servicioNombre}
              {sol.servicioFecha ? ` · ${formatDateAr(`${sol.servicioFecha}T12:00:00`)}` : ''}
            </Text>
            <View style={styles.rowBtns}>
              <CommandButton
                label="Acepto"
                variant="success"
                onPress={() => onAccept(sol)}
                disabled={busy}
                loading={busy}
                style={styles.btnFlex}
              />
              <CommandButton
                label="No puedo"
                variant="secondary"
                onPress={() => onReject(sol)}
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
    color: '#422006',
    fontSize: 11,
    fontWeight: '900',
  },
  item: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 6,
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

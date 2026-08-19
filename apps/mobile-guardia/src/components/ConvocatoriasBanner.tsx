import { StyleSheet, Text, View } from 'react-native';
import type { SolicitudEvento } from '@cosp/portal-types';
import { formatDateAr } from '@cosp/portal-core';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  convocatorias: SolicitudEvento[];
  onOpenEventos: () => void;
};

export function ConvocatoriasBanner({ convocatorias, onOpenEventos }: Props) {
  const { palette } = useTheme();
  if (convocatorias.length === 0) return null;

  const first = convocatorias[0];

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
      <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={1}>
        {first.eventoNombre}
      </Text>
      <Text style={[styles.sub, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
        {first.servicioNombre}
        {first.servicioFecha
          ? ` · ${formatDateAr(`${first.servicioFecha}T12:00:00`)}`
          : ''}
        {convocatorias.length > 1 ? ` · +${convocatorias.length - 1} más` : ''}
      </Text>
      <CommandButton label="Responder convocatoria" variant="primary" onPress={onOpenEventos} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 8,
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
  title: {
    fontSize: 17,
    fontWeight: '900',
  },
  sub: {
    fontSize: 13,
    lineHeight: 19,
  },
});

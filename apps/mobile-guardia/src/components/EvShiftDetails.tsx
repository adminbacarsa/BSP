import { Linking, StyleSheet, Text, View } from 'react-native';
import type { EvShiftDisplay } from '@cosp/portal-core';
import { CommandButton } from './ui/CommandButton';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  ev: EvShiftDisplay;
  compact?: boolean;
};

export function EvShiftDetails({ ev, compact }: Props) {
  const { palette } = useTheme();

  return (
    <View style={[styles.wrap, compact ? styles.wrapCompact : null]}>
      <View style={[styles.badge, { backgroundColor: 'rgba(234,179,8,0.2)', borderColor: palette.warning }]}>
        <Text style={[styles.badgeText, { color: palette.warning }]}>EV · {ev.nombre}</Text>
      </View>
      {ev.eventoNombre && ev.eventoNombre !== ev.nombre ? (
        <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>{ev.eventoNombre}</Text>
      ) : null}
      {ev.clienteNombre ? (
        <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>{ev.clienteNombre}</Text>
      ) : null}
      {ev.horarioBadge ? (
        <Text style={[styles.line, { color: palette.primary, fontWeight: '800' }]}>{ev.horarioBadge}</Text>
      ) : null}
      {ev.direccion ? (
        <Text style={[styles.line, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
          {ev.direccion}
        </Text>
      ) : null}
      {ev.requisitos ? (
        <Text style={[styles.hint, { color: palette.warning }]} numberOfLines={2}>
          {ev.requisitos}
        </Text>
      ) : null}
      {ev.mapsUrl ? (
        <CommandButton
          label="Cómo llegar"
          variant="secondary"
          onPress={() => void Linking.openURL(ev.mapsUrl!)}
          style={styles.mapsBtn}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 12 },
  wrapCompact: { marginTop: 8 },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: '900' },
  line: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 17 },
  mapsBtn: { alignSelf: 'flex-start', marginTop: 4 },
});

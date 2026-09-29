import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CONVOCADO_ETA_OPTIONS,
  type ConvocadoEtaMinutes,
  type RecordatorioConvocadoLike,
} from '@cosp/portal-core';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Item = RecordatorioConvocadoLike & { id: string; objectiveName?: string; positionName?: string };

type Props = {
  convocatorias: Item[];
  busyId?: string | null;
  onOnWay: (c: Item, etaMinutes: ConvocadoEtaMinutes) => void;
  onProblem: (c: Item, note: string) => void;
};

export function ConvocadoRecordatorioBanner({ convocatorias, busyId, onOnWay, onProblem }: Props) {
  const { palette } = useTheme();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (convocatorias.length === 0) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: palette.primary }]}>
      <Text style={[styles.kicker, { color: palette.primary }]}>Recordatorio</Text>
      <Text style={[styles.headline, { color: palette.onSurface }]}>¿Seguís en camino?</Text>
      {convocatorias.map((c) => {
        const busy = busyId === c.id;
        const place = [c.objectiveName, c.positionName].filter(Boolean).join(' · ') || 'tu cobertura';
        return (
          <View
            key={c.id}
            style={[styles.item, { borderColor: palette.outline, backgroundColor: palette.background }]}
          >
            <Text style={[styles.title, { color: palette.onSurface }]}>{place}</Text>
            <View style={styles.etaCol}>
              {CONVOCADO_ETA_OPTIONS.map((mins) => (
                <CommandButton
                  key={mins}
                  label={`Sí, llego en ${mins} min`}
                  variant="success"
                  onPress={() => onOnWay(c, mins)}
                  disabled={busy}
                  loading={busy}
                />
              ))}
            </View>
            <TextInput
              value={notes[c.id] || ''}
              onChangeText={(text) => setNotes((prev) => ({ ...prev, [c.id]: text.slice(0, 200) }))}
              placeholder="Texto corto (opcional)"
              placeholderTextColor={palette.onSurfaceMuted}
              style={[
                styles.note,
                { color: palette.onSurface, borderColor: palette.outline, backgroundColor: palette.card },
              ]}
              maxLength={200}
            />
            <CommandButton
              label="Tengo un problema"
              variant="danger"
              onPress={() => onProblem(c, (notes[c.id] || '').trim())}
              disabled={busy}
            />
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
    gap: 8,
  },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  headline: { fontSize: 18, fontWeight: '900' },
  item: { borderRadius: radius.md, borderWidth: 1, padding: spacing.sm, gap: 8 },
  title: { fontSize: 15, fontWeight: '800' },
  etaCol: { gap: 8 },
  note: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});

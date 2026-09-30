import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { AppModeId } from '@cosp/ops-core';
import { usePortalAuth } from '../context/PortalAuthContext';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

/**
 * Header: selector de modo (+ empresa si staff multiempresa).
 * Listas/chips de un toque — sin grillas.
 */
export function ModeSelectorBar() {
  const router = useRouter();
  const { palette } = useTheme();
  const {
    visibleModes,
    activeMode,
    setActiveMode,
    staffProfile,
    activeEmpresaId,
    setActiveEmpresaId,
    isPreviewMode,
  } = usePortalAuth();

  if (isPreviewMode) return null;
  if (visibleModes.length <= 1 && (staffProfile?.empresas?.length ?? 0) <= 1) {
    return null;
  }

  async function onSelectMode(modeId: AppModeId) {
    await setActiveMode(modeId);
    const def = visibleModes.find((m) => m.id === modeId);
    if (def?.href) router.replace(def.href as never);
  }

  return (
    <View style={[styles.wrap, { backgroundColor: palette.header, borderBottomColor: palette.cardBorder }]}>
      {visibleModes.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {visibleModes.map((m) => {
            const active = m.id === activeMode;
            return (
              <Pressable
                key={m.id}
                onPress={() => void onSelectMode(m.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? palette.primary : palette.card,
                    borderColor: active ? palette.primary : palette.cardBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? palette.onPrimary : palette.onSurface },
                  ]}
                >
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {staffProfile && staffProfile.empresas.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {staffProfile.empresas.map((e) => {
            const active = e.id === activeEmpresaId;
            return (
              <Pressable
                key={e.id}
                onPress={() => void setActiveEmpresaId(e.id)}
                style={[
                  styles.empChip,
                  {
                    backgroundColor: active ? '#0f766e' : palette.inputBg,
                    borderColor: active ? '#0f766e' : palette.cardBorder,
                  },
                ]}
              >
                <Text style={[styles.empText, { color: active ? '#fff' : palette.onSurfaceMuted }]}>
                  {e.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: '800' },
  empChip: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  empText: { fontSize: 11, fontWeight: '700' },
});

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';
import { radius, layout } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Variant = 'primary' | 'secondary' | 'success' | 'ghost' | 'danger';

type Props = PressableProps & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  style?: ViewStyle;
};

export function CommandButton({ label, variant = 'primary', loading, disabled, style, ...rest }: Props) {
  const { palette } = useTheme();

  const variantStyle = ((): { button: ViewStyle; text: { color: string } } => {
    switch (variant) {
      case 'success':
        return {
          button: { backgroundColor: palette.success },
          text: { color: palette.mode === 'darkOps' ? palette.onPrimary : '#ffffff' },
        };
      case 'secondary':
        return {
          button: {
            backgroundColor: palette.mode === 'core' ? palette.inputBg : palette.card,
            borderWidth: 1,
            borderColor: palette.outline,
          },
          text: { color: palette.primary },
        };
      case 'ghost':
        return {
          button: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: palette.outline,
          },
          text: { color: palette.onSurfaceMuted },
        };
      case 'danger':
        return {
          button: {
            backgroundColor: palette.errorContainer,
            borderWidth: 1,
            borderColor: palette.error,
          },
          text: { color: palette.onError },
        };
      default:
        return {
          button: { backgroundColor: palette.primary },
          text: { color: palette.onPrimary },
        };
    }
  })();

  const v = variantStyle;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        v.button,
        (pressed || loading || disabled) && styles.pressed,
        style,
      ]}
      disabled={disabled || loading}
      {...rest}
    >
      <Text style={[styles.label, v.text]}>{loading ? '…' : label}</Text>
    </Pressable>
  );
}

export function CommandBadge({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: palette.chipBg }]}>
      <Text style={[styles.badgeText, { color: palette.chipText }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.buttonMinHeight,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.88 },
  label: { fontSize: 16, fontWeight: '700' },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
});

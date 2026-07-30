import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';
import { colors, radius } from '../../theme/tokens';

type Variant = 'primary' | 'secondary' | 'success' | 'ghost' | 'danger';

type Props = PressableProps & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  style?: ViewStyle;
};

const variantStyles: Record<Variant, { button: ViewStyle; text: { color: string } }> = {
  primary: {
    button: { backgroundColor: colors.indigo600 },
    text: { color: colors.white },
  },
  secondary: {
    button: { backgroundColor: colors.indigo100, borderWidth: 1, borderColor: colors.indigo200 },
    text: { color: colors.indigo900 },
  },
  success: {
    button: { backgroundColor: colors.emerald600 },
    text: { color: colors.white },
  },
  ghost: {
    button: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    text: { color: colors.white },
  },
  danger: {
    button: { backgroundColor: colors.red100, borderWidth: 1, borderColor: '#fecaca' },
    text: { color: colors.red600 },
  },
};

export function CommandButton({ label, variant = 'primary', loading, disabled, style, ...rest }: Props) {
  const v = variantStyles[variant];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        v.button,
        (pressed || loading || disabled) && styles.pressed,
        style,
      ] as ViewStyle[]}
      disabled={disabled || loading}
      {...rest}
    >
      <Text style={[styles.label, v.text]}>{loading ? '…' : label}</Text>
    </Pressable>
  );
}

export function CommandBadge({ children, tone = 'indigo' }: { children: ReactNode; tone?: 'indigo' | 'emerald' | 'amber' }) {
  const toneStyle =
    tone === 'emerald'
      ? styles.badgeEmerald
      : tone === 'amber'
        ? styles.badgeAmber
        : styles.badgeIndigo;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  label: { fontSize: 15, fontWeight: '800' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeIndigo: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeEmerald: {
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderColor: 'rgba(52,211,153,0.35)',
  },
  badgeAmber: {
    backgroundColor: colors.amber100,
    borderColor: '#fde68a',
  },
  badgeText: {
    color: colors.indigo200,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});

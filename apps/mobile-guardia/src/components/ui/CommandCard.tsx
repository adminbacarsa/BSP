import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { radius, shadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  children: ReactNode;
  title?: string;
  style?: ViewStyle;
  elevated?: boolean;
};

export function CommandCard({ children, title, style, elevated = true }: Props) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.card,
          borderColor: palette.cardBorder,
        },
        elevated && palette.useCardShadow && shadow.card,
        style,
      ]}
    >
      {title ? <Text style={[styles.title, { color: palette.onSurface }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
});

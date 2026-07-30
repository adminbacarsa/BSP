import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, shadow } from '../../theme/tokens';

type Props = {
  children: ReactNode;
  title?: string;
  style?: ViewStyle;
  elevated?: boolean;
};

export function CommandCard({ children, title, style, elevated = true }: Props) {
  return (
    <View style={[styles.card, elevated && shadow.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate200,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.slate950,
    marginBottom: 4,
  },
});

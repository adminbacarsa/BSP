import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { CommandButton } from './ui/CommandButton';
import { CommandCard } from './ui/CommandCard';
import { useTheme } from '../theme/ThemeContext';

type PortalErrorPanelProps = {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: ViewStyle;
};

export function PortalErrorPanel({ title, message, retryLabel = 'Reintentar', onRetry, style }: PortalErrorPanelProps) {
  const { palette } = useTheme();
  return (
    <CommandCard title={title} style={style}>
      <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>{message}</Text>
      {onRetry ? <CommandButton label={retryLabel} variant="secondary" onPress={onRetry} /> : null}
    </CommandCard>
  );
}

export function PortalEmptyState({
  title,
  message,
  style,
}: {
  title: string;
  message: string;
  style?: ViewStyle;
}) {
  const { palette } = useTheme();
  return (
    <View style={[styles.empty, style]}>
      <Text style={[styles.emptyTitle, { color: palette.onSurface }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: palette.onSurfaceMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  empty: { paddingVertical: 24, paddingHorizontal: 8, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
});

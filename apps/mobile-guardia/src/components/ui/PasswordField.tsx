import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../../theme/tokens';

type Props = TextInputProps & {
  variant?: 'light' | 'dark';
};

export function PasswordField({ variant = 'light', style, ...rest }: Props) {
  const [visible, setVisible] = useState(false);
  const isDark = variant === 'dark';

  return (
    <View style={[styles.wrap, isDark ? styles.wrapDark : styles.wrapLight]}>
      <TextInput
        {...rest}
        style={[styles.input, isDark ? styles.inputDark : styles.inputLight, style]}
        secureTextEntry={!visible}
        placeholderTextColor={isDark ? '#94a3b8' : colors.slate500}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={styles.eye}
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        hitSlop={12}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={22}
          color={isDark ? '#94a3b8' : colors.slate500}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  wrapLight: {
    borderColor: colors.slate200,
    backgroundColor: colors.slate50,
  },
  wrapDark: {
    borderColor: '#475569',
    backgroundColor: '#0f172a',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  inputLight: { color: colors.slate950 },
  inputDark: { color: colors.white },
  eye: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

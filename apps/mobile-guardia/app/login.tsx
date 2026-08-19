import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mapPortalAuthError, usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { PasswordField } from '../src/components/ui/PasswordField';
import {
  getEmulatorHostLabel,
  isEmulatorHostMisconfiguredForDevice,
  isEmulatorMode,
} from '../src/lib/portal';
import { useEmulatorReachability } from '../src/hooks/useEmulatorReachability';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

export default function LoginScreen() {
  const { signIn, user, initializing, deviceVerified, isSuperAdmin, isPreviewMode } = usePortalAuth();
  const { palette, isDark } = useTheme();
  const [email, setEmail] = useState(isEmulatorMode() ? 'guardia@bacarsa.com.ar' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const hostMisconfigured = isEmulatorHostMisconfiguredForDevice();
  const emulatorReach = useEmulatorReachability();

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(mapPortalAuthError(err, isEmulatorMode()));
    } finally {
      setLoading(false);
    }
  }

  if (initializing) {
    return <LoadingScreen />;
  }

  if (user) {
    if (isSuperAdmin && !isPreviewMode) {
      return <Redirect href="/preview" />;
    }
    if (deviceVerified === false) {
      return <Redirect href="/device-blocked" />;
    }
    return <Redirect href="/home" />;
  }

  const shell = (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <View style={styles.brandBlock}>
            <Text style={[styles.brandBadge, isDark ? styles.brandBadgeDark : styles.brandBadgeCore]}>
              COSP · Grupo Bacar
            </Text>
            <Text style={[styles.brandTitle, { color: isDark ? palette.heroText : palette.primary }]}>
              Guardia
            </Text>
            <Text style={[styles.brandSub, { color: palette.onSurfaceMuted }]}>
              Centro de comando del vigilador
            </Text>
          </View>

          {isEmulatorMode() ? (
            <View
              style={[
                styles.emulatorBanner,
                (hostMisconfigured || emulatorReach === 'fail') && styles.emulatorDanger,
              ]}
            >
              <Text style={styles.emulatorText}>
                Lab emulador · {getEmulatorHostLabel()}
                {hostMisconfigured ? ' · Usá IP Wi‑Fi de la PC en .env' : ''}
                {emulatorReach === 'checking' ? ' · Probando red…' : ''}
                {emulatorReach === 'fail'
                  ? ' · El celular no alcanza la PC (misma Wi‑Fi, firewall, npm run start:lan)'
                  : ''}
                {emulatorReach === 'ok' ? ' · Red OK' : ''}
                {' · Tras npm run seed: contraseña guardia1234'}
              </Text>
            </View>
          ) : null}

          <CommandCard title="Ingresar">
            <Text style={[styles.legajoHint, { color: palette.onSurfaceMuted }]}>
              Usá el correo corporativo. El número de legajo aparece en el home tras ingresar.
            </Text>
            <Text style={[styles.label, { color: palette.onSurfaceMuted }]}>Correo corporativo</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: palette.outline,
                  backgroundColor: palette.inputBg,
                  color: palette.onSurface,
                },
              ]}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="guardia@empresa.com.ar"
              placeholderTextColor={palette.onSurfaceMuted}
            />
            <Text style={[styles.label, { color: palette.onSurfaceMuted }]}>Contraseña</Text>
            <PasswordField
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              textContentType="password"
              autoComplete="password"
              variant={isDark ? 'dark' : 'light'}
            />
            {error ? <Text style={[styles.error, { color: palette.warning }]}>{error}</Text> : null}
            {loading ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <CommandButton label="Entrar al portal" onPress={handleSubmit} />
            )}
          </CommandCard>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {isDark ? (
        <LinearGradient colors={['#060e20', '#0b1326', '#131b2e']} style={styles.flex}>
          {shell}
        </LinearGradient>
      ) : (
        <View style={[styles.flex, { backgroundColor: palette.surface }]}>{shell}</View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1 },
  container: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg },
  brandBlock: { gap: 8, marginBottom: 8 },
  brandBadge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  brandBadgeCore: {
    color: '#4f46e5',
    backgroundColor: '#e0e7ff',
  },
  brandBadgeDark: {
    color: '#4edea3',
    backgroundColor: 'rgba(78,222,163,0.12)',
  },
  brandTitle: { fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  brandSub: { fontSize: 15, fontWeight: '600' },
  emulatorBanner: {
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
  },
  emulatorDanger: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderColor: 'rgba(248,113,113,0.4)',
  },
  emulatorText: { color: '#fde68a', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  legajoHint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  error: { fontSize: 13, fontWeight: '600' },
});

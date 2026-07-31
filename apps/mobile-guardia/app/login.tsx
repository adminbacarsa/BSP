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
import { colors, radius } from '../src/theme/tokens';

export default function LoginScreen() {
  const { signIn, user, initializing, deviceVerified } = usePortalAuth();
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
    if (deviceVerified === false) {
      return <Redirect href="/device-blocked" />;
    }
    return <Redirect href="/home" />;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient colors={[colors.slate950, colors.indigo950, colors.indigo900]} style={styles.flex}>
        <SafeAreaView style={styles.safe}>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.container}>
              <View style={styles.brandBlock}>
                <Text style={styles.brandBadge}>COSP · Grupo Bacar</Text>
                <Text style={styles.brandTitle}>Guardia</Text>
                <Text style={styles.brandSub}>Centro de comando del vigilador</Text>
              </View>

              {isEmulatorMode() ? (
                <View style={[styles.emulatorBanner, (hostMisconfigured || emulatorReach === 'fail') && styles.emulatorDanger]}>
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

              <CommandCard title="Ingresar" style={styles.formCard}>
                <Text style={styles.label}>Correo corporativo</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="guardia@empresa.com.ar"
                  placeholderTextColor={colors.slate500}
                />
                <Text style={styles.label}>Contraseña</Text>
                <PasswordField
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  textContentType="password"
                  autoComplete="password"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {loading ? (
                  <ActivityIndicator color={colors.indigo600} />
                ) : (
                  <CommandButton label="Entrar al portal" onPress={handleSubmit} />
                )}
              </CommandCard>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 20 },
  brandBlock: { gap: 8, marginBottom: 8 },
  brandBadge: {
    alignSelf: 'flex-start',
    color: colors.indigo200,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  brandTitle: { fontSize: 40, fontWeight: '900', color: colors.white, letterSpacing: -1 },
  brandSub: { fontSize: 15, color: colors.indigo200, fontWeight: '600' },
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
  formCard: { backgroundColor: 'rgba(255,255,255,0.97)' },
  label: { fontSize: 12, fontWeight: '700', color: colors.slate600, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.slate950,
    backgroundColor: colors.slate50,
  },
  error: { color: colors.amber600, fontSize: 13, fontWeight: '600' },
});

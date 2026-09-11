import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sendPasswordResetEmail } from 'firebase/auth';
import { mapPortalAuthError, usePortalAuth } from '../src/context/PortalAuthContext';
import { LoadingScreen } from '../src/components/LoadingScreen';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { PasswordField } from '../src/components/ui/PasswordField';
import { BacarIsologo } from '../src/components/ui/BacarIsologo';
import {
  getEmulatorHostLabel,
  getPortalFirebase,
  isEmulatorHostMisconfiguredForDevice,
  isEmulatorMode,
} from '../src/lib/portal';
import { appRoutes } from '../src/lib/appRoutes';
import { useEmulatorReachability } from '../src/hooks/useEmulatorReachability';
import { useResponsiveLayout } from '../src/hooks/useResponsiveLayout';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

const BACAR_RED_BRIGHT = '#D32F2F';
const BACAR_RED_DEEP = '#8B1A1A';

export default function LoginScreen() {
  const { signIn, user, initializing, deviceVerified, isSuperAdmin, isPreviewMode } = usePortalAuth();
  const { palette, isDark } = useTheme();
  const [email, setEmail] = useState(isEmulatorMode() ? 'guardia@bacarsa.com.ar' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const hostMisconfigured = isEmulatorHostMisconfiguredForDevice();
  const emulatorReach = useEmulatorReachability();
  const { isCompact, formMaxWidth } = useResponsiveLayout();

  async function handleSubmit() {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(mapPortalAuthError(err, isEmulatorMode()));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError('');
    setInfo('');
    const mail = email.trim().toLowerCase();
    if (!mail || !mail.includes('@')) {
      setError('Ingresá tu correo corporativo para recuperar la contraseña.');
      return;
    }
    setResetBusy(true);
    try {
      const { auth } = getPortalFirebase();
      await sendPasswordResetEmail(auth, mail);
      setInfo(
        'Te enviamos un correo para restablecer la contraseña. Revisá bandeja y spam. También podés pedir a RRHH que te reenvíe el acceso.',
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        setError('No hay cuenta de portal con ese correo. Pedile a RRHH que te envíe el acceso.');
      } else if (code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Esperá unos minutos e intentá de nuevo.');
      } else {
        setError('No se pudo enviar el correo de recuperación. Intentá más tarde o pedile a RRHH.');
      }
    } finally {
      setResetBusy(false);
    }
  }

  if (initializing) {
    return <LoadingScreen />;
  }

  if (user) {
    if (isSuperAdmin && !isPreviewMode) {
      return <Redirect href={appRoutes.preview} />;
    }
    if (deviceVerified === false) {
      return <Redirect href="/device-blocked" />;
    }
    return <Redirect href={appRoutes.hoy} />;
  }

  const shell = (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.container, { maxWidth: formMaxWidth, alignSelf: 'center', width: '100%' }]}>
            <View style={styles.brandBlock}>
              <View style={styles.brandMarkWrap}>
                <BacarIsologo size={isCompact ? 72 : 88} framed />
              </View>
              <Text
                style={[
                  styles.brandTitle,
                  isCompact && styles.brandTitleCompact,
                  { color: isDark ? palette.heroText : BACAR_RED_DEEP },
                ]}
              >
                COSP Guardia
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
                  {' · Tras npm run seed: usá el usuario de prueba del seed'}
                </Text>
              </View>
            ) : null}

            <CommandCard title="Ingresar">
              <Text style={[styles.legajoHint, { color: palette.onSurfaceMuted }]}>
                Usá el correo del legajo. Si no tenés contraseña, pedí acceso a RRHH o usá «Olvidé mi
                contraseña».
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
                onChangeText={(t) => {
                  setEmail(t);
                  setError('');
                  setInfo('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="tu@empresa.com.ar"
                placeholderTextColor={palette.onSurfaceMuted}
                autoComplete="email"
                textContentType="emailAddress"
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
              {info ? <Text style={[styles.info, { color: palette.success }]}>{info}</Text> : null}
              {loading ? (
                <ActivityIndicator color={palette.primary} />
              ) : (
                <CommandButton label="Entrar al portal" onPress={handleSubmit} />
              )}
              <Pressable
                onPress={handleForgotPassword}
                disabled={resetBusy || loading}
                style={styles.forgotWrap}
                accessibilityRole="button"
                accessibilityLabel="Olvidé mi contraseña"
              >
                {resetBusy ? (
                  <ActivityIndicator color={palette.primary} size="small" />
                ) : (
                  <Text style={[styles.forgot, { color: palette.primary }]}>¿Olvidaste tu contraseña?</Text>
                )}
              </Pressable>
              <Text style={[styles.resetHint, { color: palette.onSurfaceMuted }]}>
                RRHH también puede reenviar el acceso portal desde el panel.
              </Text>
            </CommandCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {isDark ? (
        <LinearGradient colors={['#1a0a0a', '#2a1010', '#1a0a0a']} style={styles.flex}>
          {shell}
        </LinearGradient>
      ) : (
        <LinearGradient colors={['#fff5f5', '#ffe4e4', '#fff8f8']} style={styles.flex}>
          {shell}
        </LinearGradient>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  container: { gap: spacing.lg },
  brandBlock: { gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  brandMarkWrap: { marginBottom: 4 },
  brandTitle: { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  brandTitleCompact: { fontSize: 28 },
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
  info: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  forgotWrap: { alignItems: 'center', paddingVertical: 8 },
  forgot: { fontSize: 14, fontWeight: '800' },
  resetHint: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});

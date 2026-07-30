import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getMobilePlatform, getOrCreateDeviceId } from '../lib/deviceId';
import { getDeviceInfo } from '../lib/deviceInfo';
import { getPortalCallables, getPortalFirebase } from '../lib/portal';
import { PasswordField } from '../components/ui/PasswordField';

type Props = {
  token: string | null;
};

function mapActivateError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code?.replace('functions/', '') || '';
  if (code === 'already-exists') {
    return 'Este enlace ya fue utilizado. Intentá ingresar con tu correo y contraseña.';
  }
  if (code === 'deadline-exceeded') {
    return 'El enlace expiró. Pedile al administrador que reenvíe el mail de acceso.';
  }
  if (code === 'invalid-argument') {
    return e.message || 'Datos inválidos.';
  }
  return e?.message || 'Error al activar el dispositivo.';
}

export function ActivarScreen({ token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Enlace inválido</Text>
        <Text style={styles.errorBody}>El enlace de activación está incompleto o venció.</Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/login')}>
          <Text style={styles.btnText}>Ir al login</Text>
        </Pressable>
      </View>
    );
  }

  if (success) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>¡Cuenta activada!</Text>
        <Text style={styles.successBody}>Ya podés usar el portal del vigilador en este dispositivo.</Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/home')}>
          <Text style={styles.btnText}>Continuar</Text>
        </Pressable>
      </View>
    );
  }

  async function handleActivate() {
    if (!password || password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const deviceId = await getOrCreateDeviceId();
      const { activateAndSetPassword } = getPortalCallables();
      const { data } = await activateAndSetPassword({
        token: token as string,
        password,
        deviceId,
        deviceInfo: getDeviceInfo(),
        platform: getMobilePlatform(),
      });

      const { auth } = getPortalFirebase();
      await signInWithEmailAndPassword(auth, data.email, password);
      setSuccess(true);
    } catch (err) {
      setError(mapActivateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.badge}>Activación</Text>
          <Text style={styles.title}>Vincular dispositivo</Text>
          <Text style={styles.subtitle}>Creá tu contraseña para acceder al portal del vigilador.</Text>

          <Text style={styles.label}>Nueva contraseña</Text>
          <PasswordField
            variant="dark"
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 6 caracteres"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={handleActivate} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Activar y entrar</Text>}
          </Pressable>

          <Pressable onPress={() => router.replace('/login')}>
            <Text style={styles.link}>Ya tengo cuenta — iniciar sesión</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
  container: { flex: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(79,70,229,0.25)',
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 14, lineHeight: 20 },
  label: { color: '#cbd5e1', fontSize: 13, marginTop: 8 },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
  },
  error: { color: '#fbbf24', fontSize: 13 },
  btn: {
    backgroundColor: '#4f46e5',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#818cf8', textAlign: 'center', marginTop: 8, fontSize: 14 },
  center: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  errorBody: { color: '#94a3b8', textAlign: 'center' },
  successTitle: { color: '#34d399', fontSize: 22, fontWeight: '800' },
  successBody: { color: '#cbd5e1', textAlign: 'center' },
});

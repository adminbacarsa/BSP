import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useResponsiveLayout } from '../src/hooks/useResponsiveLayout';
import { getMobilePlatform } from '../src/lib/deviceId';
import { getPortalFirebase } from '../src/lib/portal';
import { requestDeviceRegistration } from '../src/lib/requestDeviceRegistration';

export default function DeviceBlockedScreen() {
  const router = useRouter();
  const { user, employee, empDocId, signOut, refreshEmployee } = usePortalAuth();
  const { formMaxWidth } = useResponsiveLayout();
  const { db } = getPortalFirebase();
  const [busy, setBusy] = useState(false);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [requestOk, setRequestOk] = useState(false);
  const isWeb = getMobilePlatform() === 'web';

  const displayName = employee
    ? `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim()
    : user?.email || null;

  async function handleRequestRegister() {
    if (!user || busy) return;
    setBusy(true);
    setRequestMsg(null);
    const result = await requestDeviceRegistration({
      db,
      uid: user.uid,
      empDocId,
      empresaId: employee?.empresaId ?? null,
      displayName,
    });
    setBusy(false);
    if (result.ok) {
      setRequestOk(true);
      setRequestMsg(
        'Solicitud enviada a RRHH / Centro de Comando. Cuando aprueben o te reenvíen el mail de activación, tocá «Reintentar verificación» o abrí el enlace del correo.',
      );
    } else {
      setRequestOk(false);
      setRequestMsg(result.message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Dispositivo no autorizado' }} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={[styles.card, { maxWidth: formMaxWidth, width: '100%', alignSelf: 'center' }]}>
            <Text style={styles.title}>Dispositivo no vinculado</Text>
            <Text style={styles.body}>
              Esta cuenta ya está activa en otro dispositivo. Cada legajo permite un dispositivo a la vez
              (Android o un navegador).
            </Text>
            {isWeb ? (
              <Text style={styles.body}>
                Si usás Safari en iPhone y no abriste COSP en varios días, el navegador puede haber borrado
                el id de este dispositivo. Pedí registro abajo o pedile a RRHH un nuevo mail de acceso.
              </Text>
            ) : (
              <Text style={styles.body}>
                Si cambiaste de teléfono, pedile a RRHH un nuevo mail de acceso y activá desde el botón
                «Abrir en COSP Guardia».
              </Text>
            )}

            <Pressable
              style={[styles.btnPrimary, busy && styles.btnDisabled]}
              onPress={handleRequestRegister}
              disabled={busy || requestOk}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>
                  {requestOk ? 'Solicitud enviada' : 'Registrar este dispositivo'}
                </Text>
              )}
            </Pressable>

            {requestMsg ? (
              <Text style={[styles.feedback, requestOk ? styles.feedbackOk : styles.feedbackErr]}>
                {requestMsg}
              </Text>
            ) : null}

            <Pressable
              style={styles.btnSecondary}
              onPress={async () => {
                await refreshEmployee();
                router.replace('/');
              }}
            >
              <Text style={styles.btnSecondaryText}>Reintentar verificación</Text>
            </Pressable>
            <Pressable
              style={styles.btn}
              onPress={async () => {
                await signOut();
                router.replace('/login');
              }}
            >
              <Text style={styles.btnText}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#fecaca',
    gap: 16,
    shadowColor: '#b91c1c',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#991b1b' },
  body: { fontSize: 14, color: '#64748b', lineHeight: 22 },
  btnPrimary: {
    backgroundColor: '#8B1A1A',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btn: {
    backgroundColor: '#4f46e5',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: '#fff', fontWeight: '700' },
  btnSecondary: {
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#334155', fontWeight: '700' },
  feedback: { fontSize: 13, lineHeight: 20 },
  feedbackOk: { color: '#047857' },
  feedbackErr: { color: '#b91c1c' },
});

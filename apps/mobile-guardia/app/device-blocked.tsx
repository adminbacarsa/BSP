import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useResponsiveLayout } from '../src/hooks/useResponsiveLayout';
import { getMobilePlatform } from '../src/lib/deviceId';
import {
  getGuardDeviceRegistrationStatus,
  requestDeviceRegistration,
  type GuardDeviceRegistrationStatus,
} from '../src/lib/requestDeviceRegistration';

export default function DeviceBlockedScreen() {
  const router = useRouter();
  const { user, employee, empDocId, signOut, refreshEmployee } = usePortalAuth();
  const { formMaxWidth } = useResponsiveLayout();
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [regStatus, setRegStatus] = useState<GuardDeviceRegistrationStatus>('none');
  const isWeb = getMobilePlatform() === 'web';

  const displayName = employee
    ? `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim()
    : user?.email || null;

  useEffect(() => {
    if (!user) {
      setStatusLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setStatusLoading(true);
      const result = await getGuardDeviceRegistrationStatus();
      if (cancelled) return;
      if (result.ok) {
        setRegStatus(result.status);
        if (result.status === 'pending') {
          setRequestMsg(
            result.message ||
              'Ya hay una solicitud pendiente. Cuando RRHH / CC la apruebe, tocá «Reintentar verificación».',
          );
        } else if (result.status === 'approved') {
          setRequestMsg(
            result.message ||
              'Tu solicitud fue aprobada. Tocá «Reintentar verificación» para continuar.',
          );
        } else if (result.status === 'rejected') {
          setRequestMsg(
            result.message ||
              'La última solicitud fue rechazada. Podés pedir registro de nuevo o contactar a RRHH.',
          );
        }
      }
      setStatusLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  async function handleRequestRegister() {
    if (!user || busy || regStatus === 'pending') return;
    setBusy(true);
    setRequestMsg(null);
    const result = await requestDeviceRegistration({
      empDocId,
      empresaId: employee?.empresaId ?? null,
      displayName,
    });
    setBusy(false);
    if (result.ok) {
      setRegStatus(result.status === 'approved' ? 'approved' : 'pending');
      setRequestMsg(
        result.status === 'approved'
          ? 'Dispositivo aprobado. Tocá «Reintentar verificación».'
          : 'Solicitud enviada a RRHH / Centro de Comando. Cuando aprueben, tocá «Reintentar verificación».',
      );
    } else {
      setRequestMsg(result.message);
    }
  }

  const requestSent = regStatus === 'pending' || regStatus === 'approved';

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

            {statusLoading ? (
              <ActivityIndicator color="#8B1A1A" />
            ) : (
              <Pressable
                style={[styles.btnPrimary, (busy || regStatus === 'pending') && styles.btnDisabled]}
                onPress={handleRequestRegister}
                disabled={busy || regStatus === 'pending' || regStatus === 'approved'}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>
                    {regStatus === 'pending'
                      ? 'Solicitud pendiente'
                      : regStatus === 'approved'
                        ? 'Aprobado — reintentá'
                        : 'Registrar este dispositivo'}
                  </Text>
                )}
              </Pressable>
            )}

            {requestMsg ? (
              <Text
                style={[
                  styles.feedback,
                  requestSent || regStatus === 'approved' ? styles.feedbackOk : styles.feedbackErr,
                ]}
              >
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

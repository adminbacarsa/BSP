import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useResponsiveLayout } from '../src/hooks/useResponsiveLayout';
import { getMobilePlatform } from '../src/lib/deviceId';
import { getPortalFirebase } from '../src/lib/portal';
import {
  getGuardDeviceRegistrationStatus,
  requestDeviceRegistration,
  type GuardDeviceRegistrationStatus,
} from '../src/lib/requestDeviceRegistration';

/** Motivo de bloqueo: nunca activó vs dispositivo distinto al vinculado. */
type BlockReason = 'loading' | 'never_activated' | 'other_device';

export default function DeviceBlockedScreen() {
  const router = useRouter();
  const { user, employee, empDocId, signOut, refreshEmployee } = usePortalAuth();
  const { formMaxWidth } = useResponsiveLayout();
  const { db } = getPortalFirebase();
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [blockReason, setBlockReason] = useState<BlockReason>('loading');
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [regStatus, setRegStatus] = useState<GuardDeviceRegistrationStatus>('none');
  const isWeb = getMobilePlatform() === 'web';

  const displayName = employee
    ? `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim()
    : user?.email || null;

  const neverActivated = blockReason === 'never_activated';
  const canRequestRegister = blockReason === 'other_device';

  useEffect(() => {
    if (!user) {
      setStatusLoading(false);
      setBlockReason('never_activated');
      return;
    }
    let cancelled = false;
    (async () => {
      setStatusLoading(true);
      setRequestMsg(null);

      let reason: BlockReason = 'other_device';
      try {
        const tokenSnap = await getDoc(doc(db, 'device_tokens', user.uid));
        if (!tokenSnap.exists() || tokenSnap.data()?.verified !== true) {
          reason = 'never_activated';
        } else {
          reason = 'other_device';
        }
      } catch {
        reason = 'other_device';
      }
      if (cancelled) return;
      setBlockReason(reason);

      if (reason === 'never_activated') {
        setStatusLoading(false);
        return;
      }

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
  }, [user?.uid, db]);

  async function handleRequestRegister() {
    if (!user || busy || !canRequestRegister || regStatus === 'pending') return;
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
      <Stack.Screen
        options={{ title: neverActivated ? 'Cuenta sin activar' : 'Dispositivo no autorizado' }}
      />
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={[styles.card, { maxWidth: formMaxWidth, width: '100%', alignSelf: 'center' }]}>
            {blockReason === 'loading' || statusLoading ? (
              <ActivityIndicator color="#8B1A1A" />
            ) : neverActivated ? (
              <>
                <Text style={styles.title}>Todavía no activaste tu cuenta</Text>
                <Text style={styles.body}>
                  Todavía no activaste tu cuenta. Usá el mail de acceso o pedile a RRHH que te lo reenvíe.
                </Text>
                {requestMsg ? <Text style={[styles.feedback, styles.feedbackErr]}>{requestMsg}</Text> : null}
              </>
            ) : (
              <>
                <Text style={styles.title}>Dispositivo no vinculado</Text>
                <Text style={styles.body}>
                  Esta cuenta ya está activa en otro dispositivo. Cada legajo permite un dispositivo a la
                  vez (Android o un navegador).
                </Text>
                {isWeb ? (
                  <Text style={styles.body}>
                    Si usás Safari en iPhone y no abriste COSP en varios días, el navegador puede haber
                    borrado el id de este dispositivo. Pedí registro abajo o pedile a RRHH un nuevo mail de
                    acceso.
                  </Text>
                ) : (
                  <Text style={styles.body}>
                    Si cambiaste de teléfono, pedile a RRHH un nuevo mail de acceso y activá desde el botón
                    «Abrir en COSP Guardia».
                  </Text>
                )}

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
              </>
            )}

            {!statusLoading && blockReason !== 'loading' ? (
              <>
                <Pressable
                  style={styles.btnSecondary}
                  onPress={async () => {
                    setRequestMsg('Verificando…');
                    await refreshEmployee();
                    router.replace('/');
                    // Si vuelve a quedar bloqueado, la pantalla se re-monta: dejar claro que se reintentó.
                    setTimeout(() => setRequestMsg('No se pudo verificar este dispositivo todavía. Si RRHH ya lo aprobó, esperá unos segundos y reintentá.'), 1500);
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
              </>
            ) : null}
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

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
  canRequestDeviceRegistration,
  DEVICE_BLOCK_MESSAGES,
  evaluateDeviceTokenBinding,
  type DeviceBlockReason,
} from '../src/lib/deviceVerification';
import { getStoredDeviceId } from '../src/lib/deviceId';
import {
  getGuardDeviceRegistrationStatus,
  requestDeviceRegistration,
  type GuardDeviceRegistrationStatus,
} from '../src/lib/requestDeviceRegistration';

export default function DeviceBlockedScreen() {
  const router = useRouter();
  const { user, employee, empDocId, signOut, refreshEmployee, deviceBlockReason } = usePortalAuth();
  const { formMaxWidth } = useResponsiveLayout();
  const { db } = getPortalFirebase();
  const [busy, setBusy] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [blockReason, setBlockReason] = useState<DeviceBlockReason | 'loading'>('loading');
  const [requestMsg, setRequestMsg] = useState<string | null>(null);
  const [regStatus, setRegStatus] = useState<GuardDeviceRegistrationStatus>('none');
  const isWeb = getMobilePlatform() === 'web';

  const displayName = employee
    ? `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim()
    : user?.email || null;

  const neverActivated = blockReason === 'never_activated';
  const needsRebind = blockReason === 'needs_rebind';
  const ownedByOther = blockReason === 'DEVICE_OWNED_BY_OTHER';
  const retiredNeedsEmail = blockReason === 'RETIRED_DEVICE_NEEDS_EMAIL';
  const canRequestRegister = canRequestDeviceRegistration(
    blockReason === 'loading' ? null : blockReason,
  );

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

      let reason: DeviceBlockReason = deviceBlockReason ?? 'other_device';

      try {
        const tokenSnap = await getDoc(doc(db, 'device_tokens', user.uid));
        const localId = await getStoredDeviceId();
        const evaluated = evaluateDeviceTokenBinding({
          tokenExists: tokenSnap.exists(),
          verified: tokenSnap.data()?.verified === true,
          boundDeviceId: (tokenSnap.data()?.deviceId as string | null | undefined) ?? null,
          localDeviceId: localId,
        });
        if (!evaluated.verified && evaluated.reason) {
          reason = evaluated.reason;
        } else if (deviceBlockReason) {
          reason = deviceBlockReason;
        }
      } catch {
        if (deviceBlockReason) reason = deviceBlockReason;
        else reason = 'other_device';
      }
      if (cancelled) return;
      setBlockReason(reason);

      if (!canRequestDeviceRegistration(reason)) {
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
  }, [user?.uid, db, deviceBlockReason]);

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
      if (result.platformCode) {
        setBlockReason(result.platformCode);
        setRequestMsg(DEVICE_BLOCK_MESSAGES[result.platformCode]);
      } else {
        setRequestMsg(result.message);
      }
    }
  }

  const requestSent = regStatus === 'pending' || regStatus === 'approved';
  const title =
    neverActivated
      ? 'Cuenta sin activar'
      : needsRebind
        ? 'Dispositivo sin validar'
        : ownedByOther
          ? 'Dispositivo de otro colaborador'
          : retiredNeedsEmail
            ? 'Dispositivo retirado'
            : 'Dispositivo no autorizado';

  const bodyMessage =
    blockReason !== 'loading' ? DEVICE_BLOCK_MESSAGES[blockReason] : '';

  return (
    <>
      <Stack.Screen options={{ title }} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={[styles.card, { maxWidth: formMaxWidth, width: '100%', alignSelf: 'center' }]}>
            {blockReason === 'loading' || statusLoading ? (
              <ActivityIndicator color="#8B1A1A" />
            ) : neverActivated || ownedByOther || retiredNeedsEmail || needsRebind ? (
              <>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.body}>{bodyMessage}</Text>
                {needsRebind && canRequestRegister ? (
                  <>
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
                              : 'Pedir aprobación a RRHH'}
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
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.title}>Dispositivo no vinculado</Text>
                <Text style={styles.body}>{bodyMessage}</Text>
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

                {canRequestRegister ? (
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
                ) : null}

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

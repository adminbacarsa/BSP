import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import {
  getStoredFcmToken,
  registerPushNotifications,
  webPushNeedsUserGesture,
  type PushRegistrationStatus,
} from '../lib/pushNotifications';
import { radius } from '../theme/tokens';
import { appAlert } from '@/lib/appAlert';

type Props = {
  /** Variante compacta dentro del banner naranja de preview. */
  compact?: boolean;
  onStatusChange?: (status: PushRegistrationStatus) => void;
};

/**
 * Web (Safari/iOS): el permiso de notificaciones exige gesto del usuario.
 * Muestra «Activar notificaciones» hasta que el token quede registrado.
 */
export function EnableWebPushButton({ compact, onStatusChange }: Props) {
  const { user, empDocId, employee, isPreviewMode, employeeProfileReady } = usePortalAuth();
  const { db } = getPortalFirebase();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const refreshVisibility = useCallback(async () => {
    if (Platform.OS !== 'web' || !user || !employeeProfileReady || !empDocId) {
      setVisible(false);
      return;
    }
    if (webPushNeedsUserGesture()) {
      setVisible(true);
      return;
    }
    // Permiso ya granted: si no hay token local, igual mostrar para re-atar al legajo.
    const stored = await getStoredFcmToken();
    setVisible(!stored);
  }, [user, employeeProfileReady, empDocId]);

  useEffect(() => {
    void refreshVisibility();
  }, [refreshVisibility, isPreviewMode, empDocId]);

  if (Platform.OS !== 'web' || !visible || !user || !empDocId) return null;

  async function handleActivate() {
    if (busy || !user) return;
    setBusy(true);
    setHint(null);
    try {
      const result = await registerPushNotifications({
        user,
        db,
        empDocId,
        empresaId: employee?.empresaId ?? null,
        previewOf: isPreviewMode,
        interactive: true,
      });
      onStatusChange?.(result.status);
      if (result.status === 'enabled') {
        setVisible(false);
        setHint(null);
        appAlert(
          'Notificaciones',
          isPreviewMode
            ? 'Push activadas en este dispositivo para el legajo en preview.'
            : 'Vas a recibir alertas de turnos y convocatorias en este navegador.',
        );
      } else if (result.status === 'denied') {
        setHint(
          'Permiso denegado. En iPhone: Ajustes → Safari → Notificaciones, o agregá COSP a la pantalla de inicio.',
        );
      } else if (result.status === 'error') {
        setHint(result.error || 'No se pudo activar.');
      } else {
        setHint('No se otorgó el permiso. Tocá de nuevo e aceptá el diálogo del navegador.');
      }
      await refreshVisibility();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={compact ? styles.compactWrap : styles.wrap}>
      <Pressable
        style={[compact ? styles.compactBtn : styles.btn, busy && styles.btnDisabled]}
        onPress={() => void handleActivate()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color={compact ? '#fff' : '#312e81'} />
        ) : (
          <Text style={compact ? styles.compactBtnText : styles.btnText}>Activar notificaciones</Text>
        )}
      </Pressable>
      {hint ? <Text style={compact ? styles.compactHint : styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginVertical: 8,
  },
  btn: {
    backgroundColor: '#e0e7ff',
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  btnText: {
    color: '#312e81',
    fontWeight: '800',
    fontSize: 14,
  },
  btnDisabled: { opacity: 0.7 },
  hint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  compactWrap: {
    gap: 6,
    marginTop: 6,
    width: '100%',
  },
  compactBtn: {
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  compactBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  compactHint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    lineHeight: 15,
  },
});

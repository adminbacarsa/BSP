import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { SesionOperadorAction } from '@cosp/ops-core';
import { usePortalAuth } from '../context/PortalAuthContext';
import { getPortalFirebase } from '../lib/portal';
import { callSesionOperador } from '../lib/sesionOperador';
import { appAlert } from '../lib/appAlert';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

type SessionRow = {
  id: string;
  operatorId: string;
  operatorName: string;
  role: 'PILOTO' | 'COPILOTO';
  pilotRequestStatus: 'NONE' | 'PENDING' | 'REJECTED';
};

function mapCallableError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Error de sala';
  const e = err as { message?: string; code?: string; details?: unknown };
  const msg = String(e.message || '').trim();
  if (msg) {
    // Firebase HttpsError: "Firebase: … (functions/…)." o message directo
    const cleaned = msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/, '');
    if (cleaned) return cleaned;
  }
  return 'No se pudo completar la acción en la sala.';
}

/**
 * Controles de sala multi-operador (solo lectura Firestore + callable).
 * - start: entra (piloto si sala vacía, copiloto si hay gente)
 * - copiloto pide mando (requestPilot); piloto acepta/rechaza
 * - end: dejar; passToAuto: piloto cierra sala
 */
export function OpsSalaControls() {
  const { palette } = useTheme();
  const { user, activeEmpresaId } = usePortalAuth();
  const { db } = getPortalFirebase();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeEmpresaId) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, 'sesiones_operador'),
      where('empresaId', '==', activeEmpresaId),
      where('status', '==', 'ACTIVO'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const now = new Date();
        const rows = snap.docs
          .map((d) => {
            const data = d.data();
            const exp = data.expiresAt?.toDate?.() as Date | undefined;
            if (exp && exp <= now) return null;
            const role = String(data.role || '').toUpperCase() === 'COPILOTO' ? 'COPILOTO' : 'PILOTO';
            const req = String(data.pilotRequestStatus || 'NONE').toUpperCase();
            const pilotRequestStatus: SessionRow['pilotRequestStatus'] =
              req === 'PENDING' ? 'PENDING' : req === 'REJECTED' ? 'REJECTED' : 'NONE';
            return {
              id: d.id,
              operatorId: String(data.operatorId || ''),
              operatorName: String(data.operatorName || 'Operador'),
              role: role as 'PILOTO' | 'COPILOTO',
              pilotRequestStatus,
            };
          })
          .filter(Boolean) as SessionRow[];
        rows.sort((a, b) => a.operatorName.localeCompare(b.operatorName));
        setSessions(rows);
        setLoading(false);
      },
      () => {
        setSessions([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [db, activeEmpresaId]);

  const pilot = useMemo(
    () => sessions.find((s) => s.role === 'PILOTO') || sessions[0] || null,
    [sessions],
  );
  const copilots = useMemo(
    () => sessions.filter((s) => s.id !== pilot?.id),
    [sessions, pilot?.id],
  );
  const mySession = useMemo(
    () => sessions.find((s) => s.operatorId === user?.uid) || null,
    [sessions, user?.uid],
  );
  const inRoom = !!mySession;
  const isPilot = !!mySession && pilot?.operatorId === user?.uid;
  const isCopiloto = !!mySession && !isPilot;
  const pendingRequest = useMemo(
    () => sessions.find((s) => s.pilotRequestStatus === 'PENDING' && s.role === 'COPILOTO') || null,
    [sessions],
  );
  const myPending = mySession?.pilotRequestStatus === 'PENDING';

  const run = useCallback(
    (action: SesionOperadorAction, title: string, confirmMsg: string) => {
      if (!user || !activeEmpresaId || busy) return;
      appAlert(title, confirmMsg, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await callSesionOperador(action, activeEmpresaId);
              } catch (e) {
                appAlert('Sala', mapCallableError(e));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]);
    },
    [user, activeEmpresaId, busy],
  );

  if (!activeEmpresaId) {
    return (
      <Text style={[styles.hint, { color: palette.onSurfaceMuted }]}>
        Elegí una empresa arriba para entrar a la sala de operaciones.
      </Text>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}>
      <Text style={[styles.title, { color: palette.onSurface }]}>Sala de operaciones</Text>
      {loading ? (
        <ActivityIndicator color={palette.primary} />
      ) : (
        <>
          <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>
            Piloto: {pilot ? pilot.operatorName : '— (modo Auto)'}
          </Text>
          <Text style={[styles.line, { color: palette.onSurfaceMuted }]}>
            Copilotos:{' '}
            {copilots.length ? copilots.map((c) => c.operatorName).join(', ') : '—'}
          </Text>
          {pendingRequest ? (
            <Text style={[styles.line, { color: palette.warning }]}>
              Pedido de mando: {pendingRequest.operatorName}
            </Text>
          ) : null}
        </>
      )}

      <View style={styles.actions}>
        {!inRoom ? (
          <Pressable
            style={[styles.btn, { backgroundColor: palette.primary }]}
            disabled={busy}
            onPress={() =>
              void run(
                'start',
                'Entrar a la sala',
                sessions.length
                  ? 'Hay sala Manual. Vas a sumarte como copiloto.'
                  : 'Vas a abrir la sala como piloto (modo Manual).',
              )
            }
          >
            <Text style={styles.btnText}>
              {busy ? '…' : sessions.length ? 'Sumarme como copiloto' : 'Tomar el mando'}
            </Text>
          </Pressable>
        ) : null}

        {isCopiloto && !myPending ? (
          <Pressable
            style={[styles.btn, { backgroundColor: '#0f766e' }]}
            disabled={busy}
            onPress={() =>
              void run('requestPilot', 'Pedir el mando', 'Se le pedirá al piloto que te ceda el mando.')
            }
          >
            <Text style={styles.btnText}>{busy ? '…' : 'Pedir el mando'}</Text>
          </Pressable>
        ) : null}

        {isCopiloto && myPending ? (
          <Pressable
            style={[styles.btn, { backgroundColor: palette.onSurfaceMuted }]}
            disabled={busy}
            onPress={() =>
              void run('cancelPilotRequest', 'Cancelar pedido', '¿Cancelás el pedido de mando?')
            }
          >
            <Text style={styles.btnText}>{busy ? '…' : 'Cancelar pedido de mando'}</Text>
          </Pressable>
        ) : null}

        {isPilot && pendingRequest ? (
          <>
            <Pressable
              style={[styles.btn, { backgroundColor: '#0f766e' }]}
              disabled={busy}
              onPress={() =>
                void run(
                  'acceptPilot',
                  'Ceder el mando',
                  `¿Aceptás ceder el mando a ${pendingRequest.operatorName}?`,
                )
              }
            >
              <Text style={styles.btnText}>
                {busy ? '…' : `Aceptar mando (${pendingRequest.operatorName})`}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: palette.error }]}
              disabled={busy}
              onPress={() =>
                void run(
                  'rejectPilot',
                  'Rechazar pedido',
                  `¿Rechazás el pedido de ${pendingRequest.operatorName}?`,
                )
              }
            >
              <Text style={styles.btnText}>{busy ? '…' : 'Rechazar pedido'}</Text>
            </Pressable>
          </>
        ) : null}

        {isPilot ? (
          <Pressable
            style={[styles.btn, { backgroundColor: '#334155' }]}
            disabled={busy}
            onPress={() =>
              void run(
                'passToAuto',
                'Pasar a Auto',
                'Se cierran todas las sesiones de la sala. ¿Confirmás?',
              )
            }
          >
            <Text style={styles.btnText}>{busy ? '…' : 'Pasar a Auto'}</Text>
          </Pressable>
        ) : null}

        {inRoom ? (
          <Pressable
            style={[styles.btn, { backgroundColor: palette.error }]}
            disabled={busy}
            onPress={() => void run('end', 'Dejar la sala', '¿Salís de la sala de operaciones?')}
          >
            <Text style={styles.btnText}>{busy ? '…' : 'Dejar'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: 10,
  },
  title: { fontSize: 16, fontWeight: '800' },
  line: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 13, lineHeight: 18 },
  actions: { gap: 8, marginTop: 4 },
  btn: {
    borderRadius: radius.lg,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

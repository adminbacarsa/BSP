import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  avisosDeTurnoSilenciosos,
  finTurnoCopy,
  type FinTurnoKind,
} from '../fichajes/relevoNotifications';
import { enviarTextoWaCloud } from './waCloudGraph';

export const WA_OUTBOX = 'wa_outbox';

export function finTurnoWaOutboxId(shiftId: string): string {
  return `fin_turno_wa_${String(shiftId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140)}`;
}

function normPhone(raw: unknown): string {
  return String(raw || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

function phoneFromEmpleado(emp: FirebaseFirestore.DocumentData | undefined): string {
  if (!emp) return '';
  return normPhone(emp.telefono || emp.phone || emp.celular || emp.whatsapp);
}

type WhatsAppProvider = 'off' | 'bridge' | 'cloud';

async function providerWhatsApp(
  db: Firestore,
  empresaId: string,
): Promise<{ provider: WhatsAppProvider }> {
  const [snapWa, snapLegacy] = await Promise.all([
    db.collection('empresas').doc(empresaId).collection('config').doc('whatsapp').get(),
    db.collection('empresas').doc(empresaId).collection('config').doc('wa-bridge').get(),
  ]);
  const raw = snapWa.exists ? snapWa.data() : null;
  const providerRaw = String(raw?.provider || '').toLowerCase();
  let provider: WhatsAppProvider =
    providerRaw === 'bridge' || providerRaw === 'cloud' || providerRaw === 'off'
      ? providerRaw
      : 'off';
  const bridgeUrl = String(raw?.bridge?.url || snapLegacy.data()?.url || '').trim();
  if (provider === 'off' && bridgeUrl) provider = 'bridge';
  if (provider === 'bridge' && !bridgeUrl && providerRaw !== 'bridge') {
    // Sin URL y sin declarar bridge: no hay canal.
    if (providerRaw !== 'cloud') provider = 'off';
  }
  return { provider };
}

/**
 * Aviso WA al saliente cuando el turno se cierra (relevo / fin / tope).
 * Cloud: Graph inmediato. Bridge (o Cloud fallido): cola `wa_outbox` para Modo Rápido.
 * Respeta CC apagado / Demo (mismo silencio que el push).
 */
export async function avisarFinTurnoPorWhatsApp(
  db: Firestore,
  params: {
    kind: FinTurnoKind;
    shiftId: string;
    employeeId: string;
    employeeName?: string;
    incomingName?: string;
    place: string;
    hm?: string;
    empresaId: string | null;
    /** Nombre de pila ya resuelto (opcional). */
    firstName?: string;
  },
): Promise<{ ok: boolean; channel?: 'cloud' | 'outbox'; error?: string }> {
  const empresaId = String(params.empresaId || '').trim();
  const employeeId = String(params.employeeId || '').trim();
  const shiftId = String(params.shiftId || '').trim();
  if (!empresaId || !employeeId || employeeId === 'VACANTE' || !shiftId) {
    return { ok: false, error: 'params' };
  }
  if (await avisosDeTurnoSilenciosos(db, empresaId)) {
    return { ok: false, error: 'silent' };
  }

  const outboxRef = db.collection(WA_OUTBOX).doc(finTurnoWaOutboxId(shiftId));
  const prev = await outboxRef.get();
  const prevStatus = String(prev.data()?.status || '');
  if (prevStatus === 'sent' || prevStatus === 'pending') {
    return { ok: true, channel: prevStatus === 'sent' ? 'cloud' : 'outbox' };
  }

  const empSnap = await db.collection('empleados').doc(employeeId).get();
  const emp = empSnap.exists ? empSnap.data() || {} : {};
  const phone = phoneFromEmpleado(emp);
  if (phone.length < 8) {
    await outboxRef.set(
      {
        empresaId,
        shiftId,
        employeeId,
        kind: params.kind,
        status: 'skipped',
        error: 'sin_telefono',
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: false, error: 'sin_telefono' };
  }

  const name =
    String(params.firstName || '').trim() ||
    String(emp.firstName || '').trim() ||
    String(params.employeeName || emp.nombre || '').trim();
  const msg = finTurnoCopy({
    kind: params.kind,
    name,
    place: params.place,
    incomingName: params.incomingName,
    hm: params.hm,
  });
  const text = `🚪 ${msg.body}`.slice(0, 4096);

  const { provider } = await providerWhatsApp(db, empresaId);
  if (provider === 'off') {
    return { ok: false, error: 'whatsapp_off' };
  }

  const base = {
    empresaId,
    shiftId,
    employeeId,
    employeeName: String(params.employeeName || emp.nombre || name || '').trim() || null,
    phone,
    text,
    kind: params.kind,
    type: 'FIN_TURNO',
    createdAt: FieldValue.serverTimestamp(),
  };

  if (provider === 'cloud') {
    const sent = await enviarTextoWaCloud(db, { empresaId, toPhone: phone, text });
    if (sent.ok === true) {
      await outboxRef.set(
        {
          ...base,
          status: 'sent',
          channel: 'cloud',
          messageId: sent.messageId || null,
          sentAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, channel: 'cloud' };
    }
    const cloudErr = sent.ok === false ? sent.error : 'cloud_fail';
    await outboxRef.set(
      {
        ...base,
        status: 'pending',
        channel: 'outbox',
        error: cloudErr || 'cloud_fail',
      },
      { merge: true },
    );
    return { ok: true, channel: 'outbox', error: cloudErr };
  }

  // Bridge: Cloud Functions no llega al PC del bridge → cola para Modo Rápido.
  await outboxRef.set(
    {
      ...base,
      status: 'pending',
      channel: 'outbox',
    },
    { merge: true },
  );
  return { ok: true, channel: 'outbox' };
}

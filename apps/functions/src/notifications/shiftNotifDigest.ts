/**
 * Digest de notificaciones de planificación por empleado.
 * Evita 31 pushes al publicar/editar en lote: acumula y flushea 1 mensaje.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const DIGEST_COLLECTION = 'shift_notif_digests';
/** Segundos sin nuevas escrituras antes de enviar el digest. */
const QUIET_MS = 45_000;

export type DigestEventType =
  | 'TURNO_NUEVO'
  | 'TURNO_MODIFICADO'
  | 'TURNO_ELIMINADO'
  | 'FRANCO_ASIGNADO';

type DigestDoc = {
  employeeId: string;
  empresaId: string | null;
  uid: string | null;
  nuevo: number;
  modificado: number;
  eliminado: number;
  franco: number;
  samples: string[];
  turnoIds: string[];
  status: 'open';
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
};

function counterField(type: DigestEventType): keyof Pick<DigestDoc, 'nuevo' | 'modificado' | 'eliminado' | 'franco'> {
  switch (type) {
    case 'TURNO_NUEVO':
      return 'nuevo';
    case 'TURNO_MODIFICADO':
      return 'modificado';
    case 'TURNO_ELIMINADO':
      return 'eliminado';
    case 'FRANCO_ASIGNADO':
      return 'franco';
  }
}

export function buildDigestMessage(d: {
  nuevo: number;
  modificado: number;
  eliminado: number;
  franco: number;
  samples: string[];
}): { title: string; body: string; type: string } {
  const parts: string[] = [];
  if (d.nuevo > 0) {
    parts.push(d.nuevo === 1 ? '1 turno nuevo' : `${d.nuevo} turnos nuevos`);
  }
  if (d.modificado > 0) {
    parts.push(d.modificado === 1 ? '1 turno modificado' : `${d.modificado} turnos modificados`);
  }
  if (d.eliminado > 0) {
    parts.push(d.eliminado === 1 ? '1 turno eliminado' : `${d.eliminado} turnos eliminados`);
  }
  if (d.franco > 0) {
    parts.push(d.franco === 1 ? '1 franco asignado' : `${d.franco} francos asignados`);
  }

  const total =
    (d.nuevo || 0) + (d.modificado || 0) + (d.eliminado || 0) + (d.franco || 0);
  const samples = (d.samples || []).filter(Boolean).slice(0, 3);

  let type = 'CAMBIO_CRONOGRAMA';
  let title = '📅 Cambios en tu cronograma';
  if (total === 1 && d.nuevo === 1) {
    type = 'TURNO_NUEVO';
    title = '📅 Nuevo turno asignado';
  } else if (total === 1 && d.modificado === 1) {
    type = 'TURNO_MODIFICADO';
    title = '🔄 Cambio en tu cronograma';
  } else if (total === 1 && d.eliminado === 1) {
    type = 'TURNO_ELIMINADO';
    title = '❌ Turno eliminado';
  } else if (total === 1 && d.franco === 1) {
    type = 'FRANCO_ASIGNADO';
    title = '🟢 Franco asignado';
  } else if (parts.length === 1 && d.nuevo > 1) {
    title = `📅 ${d.nuevo} turnos nuevos`;
    type = 'TURNO_NUEVO';
  } else if (parts.length === 1 && d.modificado > 1) {
    title = `🔄 ${d.modificado} turnos modificados`;
    type = 'TURNO_MODIFICADO';
  }

  const summary = parts.join(' · ');
  const detail = samples.length ? samples.join(' · ') : '';
  const body =
    total === 1 && detail
      ? detail
      : detail
        ? `${summary}: ${detail}`
        : summary || 'Actualizaron tu cronograma';

  return { title, body, type };
}

export async function enqueueShiftNotifDigest(
  db: admin.firestore.Firestore,
  params: {
    employeeId: string;
    empresaId?: string | null;
    eventType: DigestEventType;
    sampleBody: string;
    turnoId: string;
  },
): Promise<void> {
  const { employeeId, eventType, sampleBody, turnoId } = params;
  if (!employeeId || employeeId === 'VACANTE') return;

  const empDoc = await db.collection('empleados').doc(employeeId).get();
  const empUid: string | null = empDoc.exists ? (empDoc.data()?.uid as string) || null : null;
  const empresaId =
    String(params.empresaId || empDoc.data()?.empresaId || '').trim() || null;

  const ref = db.collection(DIGEST_COLLECTION).doc(employeeId);
  const field = counterField(eventType);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as Partial<DigestDoc>) : {};
    const samples = Array.isArray(prev.samples) ? [...prev.samples] : [];
    if (sampleBody && samples.length < 5 && !samples.includes(sampleBody)) {
      samples.push(sampleBody);
    }
    const turnoIds = Array.isArray(prev.turnoIds) ? [...prev.turnoIds] : [];
    if (turnoId && turnoIds.length < 40 && !turnoIds.includes(turnoId)) {
      turnoIds.push(turnoId);
    }

    const next: DigestDoc = {
      employeeId,
      empresaId: (prev.empresaId as string) || empresaId,
      uid: (prev.uid as string) || empUid,
      nuevo: Number(prev.nuevo || 0),
      modificado: Number(prev.modificado || 0),
      eliminado: Number(prev.eliminado || 0),
      franco: Number(prev.franco || 0),
      samples,
      turnoIds,
      status: 'open',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    next[field] = Number(next[field] || 0) + 1;
    tx.set(ref, next, { merge: true });
  });
}

async function sendDigestPushAndInbox(
  db: admin.firestore.Firestore,
  employeeId: string,
  data: DigestDoc & { updatedAt?: admin.firestore.Timestamp },
): Promise<void> {
  const msg = buildDigestMessage({
    nuevo: data.nuevo || 0,
    modificado: data.modificado || 0,
    eliminado: data.eliminado || 0,
    franco: data.franco || 0,
    samples: data.samples || [],
  });

  let empUid = data.uid || null;
  if (!empUid) {
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    empUid = empDoc.exists ? (empDoc.data()?.uid as string) || null : null;
  }

  const [byEmpId, byUid] = await Promise.all([
    db.collection('device_tokens').where('employeeId', '==', employeeId).get(),
    empUid
      ? db.collection('device_tokens').where('uid', '==', empUid).get()
      : Promise.resolve({ docs: [] as admin.firestore.QueryDocumentSnapshot[] }),
  ]);
  const tokenSet = new Set<string>();
  [...byEmpId.docs, ...byUid.docs].forEach((d) => {
    const t = d.data()?.token;
    if (typeof t === 'string' && t.length > 10) tokenSet.add(t);
  });
  const tokens = Array.from(tokenSet);

  let notifDocId: string | null = null;
  try {
    const ref = await db.collection('user_notifications').add({
      uid: empUid,
      employeeId,
      title: msg.title,
      body: msg.body,
      type: msg.type,
      target: 'employee',
      requiresAck: true,
      ackedAt: null,
      read: false,
      readAt: null,
      empresaId: data.empresaId || null,
      digest: true,
      digestCounts: {
        nuevo: data.nuevo || 0,
        modificado: data.modificado || 0,
        eliminado: data.eliminado || 0,
        franco: data.franco || 0,
      },
      turnoIds: (data.turnoIds || []).slice(0, 40),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    notifDocId = ref.id;
  } catch (e) {
    console.error('[flushShiftNotifDigests] inbox error:', (e as Error)?.message);
  }

  if (!tokens.length) {
    console.warn('[flushShiftNotifDigests] sin tokens', employeeId);
    return;
  }

  const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
  try {
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: msg.title, body: msg.body },
      data: {
        type: msg.type,
        title: msg.title,
        body: msg.body,
        employeeId,
        notificationId: notifDocId || '',
        link,
      },
      android: { priority: 'high' as const },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: { link },
      },
    });
  } catch (e) {
    console.warn('[flushShiftNotifDigests] FCM error:', (e as Error)?.message);
  }
}

export const flushShiftNotifDigests = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .pubsub.schedule('every 1 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const cutoffMs = Date.now() - QUIET_MS;
    const snap = await db
      .collection(DIGEST_COLLECTION)
      .where('status', '==', 'open')
      .limit(80)
      .get();

    let flushed = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as DigestDoc & { updatedAt?: admin.firestore.Timestamp };
      const updatedMs = data.updatedAt?.toMillis?.() ?? 0;
      if (updatedMs > cutoffMs) continue; // aún reciben escrituras

      const total =
        (data.nuevo || 0) +
        (data.modificado || 0) +
        (data.eliminado || 0) +
        (data.franco || 0);
      if (total <= 0) {
        await docSnap.ref.delete().catch(() => undefined);
        continue;
      }

      // Claim atómico
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(docSnap.ref);
        if (!fresh.exists) return null;
        const cur = fresh.data() as DigestDoc & { updatedAt?: admin.firestore.Timestamp };
        if (cur.status !== 'open') return null;
        const um = cur.updatedAt?.toMillis?.() ?? 0;
        if (um > cutoffMs) return null;
        tx.delete(docSnap.ref);
        return cur;
      });

      if (!claimed) continue;
      await sendDigestPushAndInbox(db, docSnap.id, claimed);
      flushed++;
    }

    if (flushed > 0) {
      console.log(`[flushShiftNotifDigests] Enviados ${flushed} digest(s)`);
    }
    return null;
  });

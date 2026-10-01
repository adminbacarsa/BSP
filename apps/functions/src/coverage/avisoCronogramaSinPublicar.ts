import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { ObjectiveOperationCache } from '../common/simulableShift';

const TZ = 'America/Argentina/Cordoba';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function arParts(d: Date): { ymd: string; hour: number; year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = get('day');
  return {
    ymd: `${get('year')}-${String(month).padStart(2, '0')}-${day}`,
    hour: Number(get('hour')),
    year,
    month,
  };
}

function addDays(ymd: string, days: number): { ymd: string; year: number; month: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth() + 1;
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return { ymd: `${year}-${String(month).padStart(2, '0')}-${day}`, year, month };
}

/** Hora de corte: la franja que cruza la medianoche (N 23–07 → 07:00). */
export function corteServicioHm(positions: unknown): string | null {
  let best: string | null = null;
  const list = Array.isArray(positions) ? positions : [];
  for (const pos of list) {
    const bands = (pos as { allowedShiftTypes?: unknown[] })?.allowedShiftTypes;
    if (!Array.isArray(bands)) continue;
    for (const band of bands) {
      const start = String((band as { startTime?: string }).startTime || '').slice(0, 5);
      const end = String((band as { endTime?: string }).endTime || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
      if (end <= start && (!best || end > best)) best = end;
    }
  }
  return best;
}

export async function runAvisoCronogramaSinPublicar(
  db: Firestore,
  now: Date = new Date(),
): Promise<{ created: number; skipped?: string }> {
  const clock = arParts(now);
  if (clock.hour !== 18) return { created: 0, skipped: 'NOT_18' };
  const tomorrow = addDays(clock.ymd, 1);
  const mes = MESES[tomorrow.month - 1] || String(tomorrow.month);
  const probe = admin.firestore.Timestamp.fromDate(new Date(`${tomorrow.ymd}T12:00:00-03:00`));
  const cache = new ObjectiveOperationCache();
  const empresas = await db.collection('empresas').get();
  let created = 0;

  for (const emp of empresas.docs) {
    const empresaId = emp.id;
    const slaSnap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
    const byObjective = new Map<string, FirebaseFirestore.DocumentData>();
    slaSnap.docs.forEach((d) => {
      const data = d.data();
      const oid = String(data.objectiveId || '').trim();
      if (oid && !byObjective.has(oid)) byObjective.set(oid, data);
    });

    for (const [objectiveId, sla] of byObjective) {
      const verdict = await cache.operationVerdict(db, {
        empresaId,
        objectiveId,
        startTime: probe,
      });
      if (verdict !== 'OUT') continue;
      const id = `crono_sin_pub_${empresaId}_${objectiveId}_${tomorrow.ymd}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const ref = db.collection('novedades').doc(id);
      const prev = await ref.get();
      if (prev.exists) continue;
      const name = String(sla.objectiveName || sla.name || objectiveId);
      const corte = corteServicioHm(sla.positions);
      const description = corte
        ? `${name}: ${mes} sin cronograma publicado. Mañana el servicio se corta a las ${corte}.`
        : `${name}: ${mes} sin cronograma publicado. Mañana el servicio no entra en operación.`;
      await ref.set({
        type: 'CRONOGRAMA_SIN_PUBLICAR',
        status: 'PENDIENTE',
        empresaId,
        objectiveId,
        objectiveName: name,
        clientId: sla.clientId || null,
        description,
        informational: true,
        dayYmd: tomorrow.ymd,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'CRONOGRAMA_18',
      });
      created += 1;
      await pushPlanificacion(db, empresaId, description).catch((e) => {
        console.warn('[cronogramaSinPublicar] push:', (e as Error)?.message);
      });
    }
  }
  return { created };
}

async function pushPlanificacion(db: Firestore, empresaId: string, body: string): Promise<void> {
  const { resolverAvisos } = await import('../eventuales-shared/avisos.mjs') as {
    resolverAvisos: (input: Record<string, unknown>) => { pushes: { token: string }[] };
  };
  const empresa = await db.collection('empresas').doc(empresaId).get();
  const avisos = (empresa.data()?.avisos || {}) as Record<string, unknown>;
  const configured = Array.isArray(avisos.CRONOGRAMA_SIN_PUBLICAR) && avisos.CRONOGRAMA_SIN_PUBLICAR.length > 0;
  const efectivos = configured
    ? avisos
    : {
      ...avisos,
      CRONOGRAMA_SIN_PUBLICAR: [{ tipo: 'ROL', rolDestino: 'PLANIFICACION', canales: { push: true, mail: false, whatsapp: false } }],
    };
  const usersSnap = await db.collection('system_users').where('empresaId', '==', empresaId).get();
  const usuarios = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const roleIds = [...new Set(usuarios.map((u) => String((u as { role?: string }).role || '')).filter(Boolean))];
  const roleSnaps = roleIds.length
    ? await db.getAll(...roleIds.map((id) => db.collection('roles').doc(id)))
    : [];
  const roles = roleSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  const tokens: { uid: string; token: string }[] = [];
  const uids = usuarios.map((u) => u.uid);
  for (let i = 0; i < uids.length; i += 10) {
    const slice = uids.slice(i, i + 10);
    if (!slice.length) continue;
    const tok = await db.collection('device_tokens').where('uid', 'in', slice).get();
    tok.docs.forEach((d) => {
      const token = d.data()?.token;
      if (typeof token === 'string' && token.length > 10) tokens.push({ uid: String(d.data()?.uid || ''), token });
    });
  }
  const resuelto = resolverAvisos({ avisos: efectivos, tipo: 'CRONOGRAMA_SIN_PUBLICAR', usuarios, roles, tokens });
  const pushTokens = [...new Set((resuelto.pushes || []).map((p) => p.token).filter(Boolean))];
  if (!pushTokens.length) return;
  await admin.messaging().sendEachForMulticast({
    tokens: pushTokens,
    notification: { title: 'Cronograma sin publicar', body },
    data: { type: 'CRONOGRAMA_SIN_PUBLICAR', empresaId },
  });
}

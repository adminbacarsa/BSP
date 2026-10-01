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

const VISTA = new Set(['ATENDIDA', 'atendida']);

/** Id de la novedad: UNA por empresa, objetivo y mes (antes era por día y se acumulaban). */
export function cronogramaSinPublicarDocId(empresaId: string, objectiveId: string, mesKey: string): string {
  return `crono_sin_pub_${empresaId}_${objectiveId}_${mesKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}

/**
 * Si ya existía una novedad del mismo objetivo-mes marcada como vista (por ejemplo las
 * diarias del cron anterior) con el mismo texto, la nueva nace vista: nada cambió.
 */
async function vistaHeredada(
  db: Firestore,
  empresaId: string,
  objectiveId: string,
  mesKey: string,
  description: string,
): Promise<Record<string, unknown> | null> {
  const snap = await db.collection('novedades')
    .where('empresaId', '==', empresaId)
    .where('objectiveId', '==', objectiveId)
    .where('type', '==', 'CRONOGRAMA_SIN_PUBLICAR')
    .get();
  const previas = snap.docs
    .map((d) => d.data())
    .filter((d) => {
      const mesDoc = String(d.mesKey || String(d.dayYmd || '').slice(0, 7));
      return mesDoc === mesKey && VISTA.has(String(d.status || ''));
    })
    .sort((a, b) => ((b.atendidaAt as { toMillis?: () => number })?.toMillis?.() || 0) - ((a.atendidaAt as { toMillis?: () => number })?.toMillis?.() || 0));
  const ultima = previas[0];
  if (!ultima || String(ultima.description || '') !== description) return null;
  return {
    status: 'ATENDIDA',
    atendidaAt: ultima.atendidaAt || admin.firestore.FieldValue.serverTimestamp(),
    atendidaPor: ultima.atendidaPor || 'Sistema',
    atendidaPorUid: ultima.atendidaPorUid || null,
    vistaHeredadaDe: ultima.dayYmd || null,
  };
}

export async function runAvisoCronogramaSinPublicar(
  db: Firestore,
  now: Date = new Date(),
): Promise<{ created: number; updated: number; skipped?: string }> {
  const clock = arParts(now);
  if (clock.hour !== 18) return { created: 0, updated: 0, skipped: 'NOT_18' };
  const tomorrow = addDays(clock.ymd, 1);
  const mes = MESES[tomorrow.month - 1] || String(tomorrow.month);
  const mesKey = `${tomorrow.year}-${String(tomorrow.month).padStart(2, '0')}`;
  const probe = admin.firestore.Timestamp.fromDate(new Date(`${tomorrow.ymd}T12:00:00-03:00`));
  const cache = new ObjectiveOperationCache();
  const empresas = await db.collection('empresas').get();
  let created = 0;
  let updated = 0;

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
      const ref = db.collection('novedades').doc(cronogramaSinPublicarDocId(empresaId, objectiveId, mesKey));
      const name = String(sla.objectiveName || sla.name || objectiveId);
      const corte = corteServicioHm(sla.positions);
      const description = corte
        ? `${name}: ${mes} sin cronograma publicado. Mañana el servicio se corta a las ${corte}.`
        : `${name}: ${mes} sin cronograma publicado. Mañana el servicio no entra en operación.`;
      const prev = await ref.get();
      if (prev.exists) {
        // Misma novedad del objetivo-mes: se actualiza el día y el texto; el status (vista o no) no cambia.
        if (prev.data()?.dayYmd === tomorrow.ymd) continue;
        await ref.set({
          description,
          objectiveName: name,
          corteHm: corte,
          dayYmd: tomorrow.ymd,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          vecesAvisado: admin.firestore.FieldValue.increment(1),
        }, { merge: true });
        updated += 1;
        continue;
      }
      const heredada = await vistaHeredada(db, empresaId, objectiveId, mesKey, description);
      await ref.set({
        type: 'CRONOGRAMA_SIN_PUBLICAR',
        status: 'PENDIENTE',
        empresaId,
        objectiveId,
        objectiveName: name,
        clientId: sla.clientId || null,
        description,
        informational: true,
        mesKey,
        year: tomorrow.year,
        month: tomorrow.month,
        corteHm: corte,
        dayYmd: tomorrow.ymd,
        vecesAvisado: 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'CRONOGRAMA_18',
        ...(heredada || {}),
      });
      created += 1;
      if (heredada) continue;
      await pushPlanificacion(db, empresaId, description).catch((e) => {
        console.warn('[cronogramaSinPublicar] push:', (e as Error)?.message);
      });
    }
  }
  return { created, updated };
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

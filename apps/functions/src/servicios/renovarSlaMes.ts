/**
 * Al publicar el cronograma del último mes de un SLA con renovación automática,
 * crea (o extiende) solo el mes siguiente. Despublicar no borra. Idempotente.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const pad = (n: number) => String(n).padStart(2, '0');

function publishedAtMillis(value: unknown): number | null {
  if (value == null || value === '') return null;
  const t = value as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const n = new Date(value).getTime();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ymd(v: unknown): string {
  if (!v) return '';
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return t.toDate().toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

function nextMonthOf(year: number, month: number): { year: number; month: number; start: string; end: string; key: string; nombre: string } {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  const last = new Date(y, m, 0).getDate();
  return {
    year: y,
    month: m,
    start: `${y}-${pad(m)}-01`,
    end: `${y}-${pad(m)}-${pad(last)}`,
    key: monthKeyOf(y, m),
    nombre: MONTHS[m - 1] || String(m),
  };
}

function isInactiveStatus(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  return st === 'inactive' || st === 'inactivo' || st === 'cancelled' || st === 'cancelado';
}

function objectiveActive(obj: { status?: unknown; active?: unknown } | undefined): boolean {
  if (!obj) return true;
  if (obj.active === false) return false;
  return String(obj.status ?? '').trim().toUpperCase() !== 'INACTIVE';
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

type SlaDoc = admin.firestore.QueryDocumentSnapshot;

export type RenovarSlaResult = {
  action: 'skip' | 'created' | 'extended';
  reason?: string;
  slaId?: string;
};

export async function renovarSlaAlPublicar(
  db: admin.firestore.Firestore,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<RenovarSlaResult> {
  if (!after) return { action: 'skip', reason: 'borrado' };
  const afterPub = publishedAtMillis(after.publishedAt);
  if (afterPub == null) return { action: 'skip', reason: 'sin_publicar' };
  const beforePub = before ? publishedAtMillis(before.publishedAt) : null;
  if (beforePub != null && beforePub === afterPub) return { action: 'skip', reason: 'ya_publicado' };

  const objectiveId = String(after.objectiveId ?? after.objetivoId ?? '').trim();
  const year = Number(after.year ?? after.año);
  const month = Number(after.month ?? after.mes);
  const empresaId = String(after.empresaId ?? '').trim();
  if (!objectiveId || !year || !month || month < 1 || month > 12) {
    return { action: 'skip', reason: 'doc_incompleto' };
  }
  const publishedKey = monthKeyOf(year, month);

  const snap = await db.collection('servicios_sla').where('objectiveId', '==', objectiveId).get();
  const rows = snap.docs.filter((d) => {
    const x = d.data();
    if (empresaId && String(x.empresaId || '') && String(x.empresaId) !== empresaId) return false;
    return true;
  });

  const last = pickLastOfPublishedMonth(rows, publishedKey);
  if (!last) return { action: 'skip', reason: 'no_es_el_ultimo_mes' };
  const data = last.data();
  if (data.autoRenewMonthly !== true) return { action: 'skip', reason: 'sin_renovacion' };
  if (data.closed === true || isInactiveStatus(data.status)) return { action: 'skip', reason: 'cerrado_o_inactivo' };

  const clientId = String(data.clientId || '').trim();
  if (clientId) {
    const clientSnap = await db.collection('clients').doc(clientId).get();
    const client = clientSnap.data() || {};
    if (!clientSnap.exists || isInactiveStatus(client.status) || String(client.status || '').toUpperCase() === 'INACTIVE') {
      return { action: 'skip', reason: 'cliente_inactivo' };
    }
    const objs = (client.objetivos || client.objectives || []) as Array<{ id?: string; status?: unknown; active?: unknown }>;
    const obj = objs.find((o) => String(o.id || '') === objectiveId);
    if (!objectiveActive(obj)) return { action: 'skip', reason: 'objetivo_inactivo' };
  }

  const next = nextMonthOf(year, month);
  const others = rows.filter((d) => d.id !== last.id);
  const clash = others.some((d) => {
    const x = d.data();
    if (isInactiveStatus(x.status)) return false;
    const s = ymd(x.startDate);
    const e = ymd(x.endDate);
    return !!s && !!e && rangesOverlap(next.start, next.end, s, e);
  });
  if (clash) return { action: 'skip', reason: 'ya_existe' };

  const nombre = String(data.objectiveName || data.clientName || objectiveId);
  const grouped = !String(data.slaSeriesId || '').trim();
  if (grouped) {
    await last.ref.update({ endDate: next.end });
    await registrar(db, {
      empresaId: String(data.empresaId || empresaId),
      objectiveId,
      objectiveName: nombre,
      clientId,
      slaId: last.id,
      description: `Se creó el servicio de ${next.nombre} para ${nombre}`,
      extended: true,
    });
    return { action: 'extended', slaId: last.id, reason: next.key };
  }

  const seriesId = String(data.slaSeriesId);
  const copy: Record<string, unknown> = {
    clientId: data.clientId,
    clientName: data.clientName || '',
    objectiveId,
    objectiveName: data.objectiveName || '',
    empresaId: data.empresaId || empresaId || undefined,
    positions: data.positions || [],
    billingMode: data.billingMode ?? null,
    billingFixedMonthlyHours: data.billingFixedMonthlyHours,
    billingFixedMonthlyAmount: data.billingFixedMonthlyAmount,
    billingPurchaseOrderId: data.billingPurchaseOrderId,
    encargadoEmployeeId: data.encargadoEmployeeId || '',
    encargadoEmployeeName: data.encargadoEmployeeName || '',
    autoRenewMonthly: true,
    ...(data.exigeCobertura === false ? { exigeCobertura: false } : {}),
    slaSeriesId: seriesId,
    status: 'active',
    closed: false,
    startDate: next.start,
    endDate: next.end,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'RENOVACION_AUTOMATICA',
  };
  for (const key of Object.keys(copy)) {
    if (copy[key] === undefined) delete copy[key];
  }
  const ref = await db.collection('servicios_sla').add(copy);
  await registrar(db, {
    empresaId: String(data.empresaId || empresaId),
    objectiveId,
    objectiveName: nombre,
    clientId,
    slaId: ref.id,
    description: `Se creó el servicio de ${next.nombre} para ${nombre}`,
    extended: false,
  });
  return { action: 'created', slaId: ref.id, reason: next.key };
}

function pickLastOfPublishedMonth(rows: SlaDoc[], publishedKey: string): SlaDoc | null {
  const open = rows.filter((d) => {
    const x = d.data();
    return !isInactiveStatus(x.status) && ymd(x.endDate);
  });
  const bySeries = new Map<string, SlaDoc[]>();
  for (const d of open) {
    const series = String(d.data().slaSeriesId || '').trim() || `solo:${d.id}`;
    const list = bySeries.get(series) || [];
    list.push(d);
    bySeries.set(series, list);
  }
  for (const list of bySeries.values()) {
    const last = list.slice().sort((a, b) => ymd(b.data().endDate).localeCompare(ymd(a.data().endDate)))[0];
    if (ymd(last.data().endDate).slice(0, 7) === publishedKey) return last;
  }
  return null;
}

async function registrar(
  db: admin.firestore.Firestore,
  info: {
    empresaId: string;
    objectiveId: string;
    objectiveName: string;
    clientId: string;
    slaId: string;
    description: string;
    extended: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db.collection('audit_logs').add({
    action: info.extended ? 'SLA_RENOVACION_EXTENDIDA' : 'SLA_RENOVACION_AUTOMATICA',
    module: 'SERVICES',
    actorName: 'Sistema',
    actorUid: 'SYSTEM',
    empresaId: info.empresaId || null,
    objectiveId: info.objectiveId,
    slaId: info.slaId,
    detail: info.description,
    timestamp: now,
  });
  await db.collection('novedades').add({
    type: 'SLA_RENOVADO',
    status: 'PENDIENTE',
    source: 'SISTEMA',
    empresaId: info.empresaId || null,
    objectiveId: info.objectiveId,
    objectiveName: info.objectiveName,
    clientId: info.clientId || null,
    slaId: info.slaId,
    description: info.description,
    createdAt: now,
  });
}

export const onPlanificacionPublicadaRenovarSla = onDocumentWritten(
  { document: 'planificacion_estados/{docId}', region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (event) => {
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const r = await renovarSlaAlPublicar(admin.firestore(), before, after);
    if (r.action !== 'skip') console.log('[renovarSla]', r.action, r.reason, r.slaId);
  },
);

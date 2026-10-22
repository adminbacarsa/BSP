/**
 * Al publicar el cronograma del último mes de un SLA, crea el doc del mes siguiente
 * con la misma copia que Planificación (`copiarSlaMes`). No depende de autoRenewMonthly.
 * Despublicar no borra. Idempotente. Solo copia M-1 si está abierto y el cliente sigue activo.
 * Un SLA cerrado, un hueco o un cliente inactivo no se renuevan.
 */
import { decidirCopiaSlaMes, idCopiaSlaMes, slaCubreMes } from './copiarSlaMes';
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
  if (data.closed === true || isInactiveStatus(data.status)) return { action: 'skip', reason: 'cerrado_o_inactivo' };

  const clientId = String(data.clientId || '').trim();
  let clienteDoc: Record<string, unknown> | null = null;
  if (clientId) {
    const clientSnap = await db.collection('clients').doc(clientId).get();
    const client = clientSnap.data() || {};
    clienteDoc = client;
    if (!clientSnap.exists || isInactiveStatus(client.status) || String(client.status || '').toUpperCase() === 'INACTIVE' || client.active === false || client.isActive === false) {
      return { action: 'skip', reason: 'cliente_inactivo' };
    }
    const objs = (client.objetivos || client.objectives || []) as Array<{ id?: string; status?: unknown; active?: unknown }>;
    const obj = objs.find((o) => String(o.id || '') === objectiveId);
    if (!objectiveActive(obj)) return { action: 'skip', reason: 'objetivo_inactivo' };
  }

  const next = nextMonthOf(year, month);
  const clienteDecision = clientId ? clienteDoc : undefined;
  const previo = decidirCopiaSlaMes(
    rows.map((d) => ({ id: d.id, ...d.data() })),
    next.key,
    { ahora: new Date().toISOString(), modo: 'automatico', cliente: clienteDecision },
  );
  if (previo.accion === 'existe') return { action: 'skip', reason: 'ya_existe' };
  if (previo.accion === 'omitir') return { action: 'skip', reason: previo.motivo };
  if (previo.accion !== 'crear') return { action: 'skip', reason: 'sin_origen' };

  const nombre = String(data.objectiveName || data.clientName || objectiveId);
  const slaId = idCopiaSlaMes(objectiveId, next.key);
  const ref = db.collection('servicios_sla').doc(slaId);
  const createdId = await db.runTransaction(async (tx) => {
    const snapTx = await tx.get(db.collection('servicios_sla').where('objectiveId', '==', objectiveId));
    const rowsTx = snapTx.docs.filter((d) => {
      const x = d.data();
      if (empresaId && String(x.empresaId || '') && String(x.empresaId) !== empresaId) return false;
      return true;
    });
    const decision = decidirCopiaSlaMes(
      rowsTx.map((d) => ({ id: d.id, ...d.data() })),
      next.key,
      { ahora: new Date().toISOString(), modo: 'automatico', cliente: clienteDecision },
    );
    if (decision.accion !== 'crear') return null;
    if (snapTx.docs.some((d) => d.id === slaId)) return null;
    if (rowsTx.some((d) => slaCubreMes({ id: d.id, ...d.data() }, next.key))) return null;
    const uno = await tx.get(ref);
    if (uno.exists) return null;
    if (decision.serieNuevaEnOrigen && !decision.origenCerrado && decision.origenId) {
      const origen = rowsTx.find((d) => d.id === decision.origenId);
      if (origen) tx.update(origen.ref, { slaSeriesId: decision.serieNuevaEnOrigen });
    }
    const copy: Record<string, unknown> = {
      ...decision.doc,
      empresaId: decision.doc.empresaId || empresaId || undefined,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'RENOVACION_AUTOMATICA',
    };
    for (const key of Object.keys(copy)) {
      if (copy[key] === undefined) delete copy[key];
    }
    tx.create(ref, copy as admin.firestore.DocumentData);
    return ref.id;
  });
  if (!createdId) return { action: 'skip', reason: 'ya_existe' };
  await registrar(db, {
    empresaId: String(data.empresaId || empresaId),
    objectiveId,
    objectiveName: nombre,
    clientId,
    slaId: createdId,
    description: `Se creó el servicio de ${next.nombre} para ${nombre}`,
    extended: false,
  });
  return { action: 'created', slaId: createdId, reason: next.key };
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

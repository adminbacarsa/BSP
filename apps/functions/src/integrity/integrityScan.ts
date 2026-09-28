import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { hotWindow } from '../ops/dataRetention';
import {
  arDateKey,
  integrityNovedadDescription,
  integrityReportId,
  scanLoadedEmpresa,
  type ClientLookup,
  type IntegrityReportBody,
} from './integrityClassify';

type ClientDoc = {
  id: string;
  empresaId?: unknown;
  objetivos?: Array<{ id?: unknown; objectiveId?: unknown }>;
  objectives?: Array<{ id?: unknown; objectiveId?: unknown }>;
  status?: unknown;
};

function objectiveIdsOf(data: ClientDoc): string[] {
  const raw = data.objetivos || data.objectives || [];
  const ids: string[] = [];
  for (const row of raw) {
    const id = String(row?.id ?? row?.objectiveId ?? '').trim();
    if (id) ids.push(id);
  }
  return ids;
}

function isInactiveEmpresa(status: unknown): boolean {
  const u = String(status ?? '').trim().toUpperCase();
  return u === 'INACTIVE' || u === 'INACTIVO';
}

function turnoStart(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function loadClientsByEmpresa(
  db: admin.firestore.Firestore,
  empresaId: string,
): Promise<{ byId: Map<string, ClientLookup>; objectiveIds: Set<string> }> {
  const snap = await db.collection('clients').where('empresaId', '==', empresaId).get();
  const byId = new Map<string, ClientLookup>();
  const objectiveIds = new Set<string>();
  snap.docs.forEach((d) => {
    const data = d.data() as ClientDoc;
    byId.set(d.id, { empresaId: String(data.empresaId || empresaId), exists: true });
    for (const oid of objectiveIdsOf({ ...data, id: d.id })) objectiveIds.add(oid);
  });
  return { byId, objectiveIds };
}

async function hydrateMissingClients(
  db: admin.firestore.Firestore,
  byId: Map<string, ClientLookup>,
  ids: string[],
): Promise<void> {
  const missing = [...new Set(ids.map((x) => String(x || '').trim()).filter((id) => id && !byId.has(id)))];
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const refs = chunk.map((id) => db.collection('clients').doc(id));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      const id = chunk[idx];
      if (!snap.exists) {
        byId.set(id, { empresaId: '', exists: false });
        return;
      }
      const data = snap.data() as ClientDoc;
      byId.set(id, { empresaId: String(data.empresaId || ''), exists: true });
    });
  }
}

async function loadHotTurnos(
  db: admin.firestore.Firestore,
  empresaId: string,
  start: Date,
  end: Date,
): Promise<Array<{ id: string; clientId?: unknown; objectiveId?: unknown; empresaId?: unknown }>> {
  const rows: Array<{ id: string; clientId?: unknown; objectiveId?: unknown; empresaId?: unknown }> = [];
  const bounds: Array<[admin.firestore.Timestamp | string, admin.firestore.Timestamp | string]> = [
    [admin.firestore.Timestamp.fromDate(start), admin.firestore.Timestamp.fromDate(end)],
    [start.toISOString(), end.toISOString()],
  ];
  const seen = new Set<string>();
  for (const [from, to] of bounds) {
    let last: admin.firestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection('turnos')
        .where('empresaId', '==', empresaId)
        .where('startTime', '>=', from)
        .where('startTime', '<=', to)
        .orderBy('startTime', 'asc')
        .limit(400);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        if (seen.has(d.id)) continue;
        const data = d.data();
        const st = turnoStart(data.startTime);
        if (!st || st < start || st > end) continue;
        seen.add(d.id);
        rows.push({
          id: d.id,
          clientId: data.clientId,
          objectiveId: data.objectiveId,
          empresaId: data.empresaId,
        });
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 400 || rows.length >= 20000) break;
    }
  }
  return rows;
}

async function loadSlas(
  db: admin.firestore.Firestore,
  empresaId: string,
): Promise<Array<{ id: string; clientId?: unknown }>> {
  const snap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
  return snap.docs.map((d) => ({ id: d.id, clientId: d.data().clientId }));
}

export async function runIntegrityScanForEmpresa(
  db: admin.firestore.Firestore,
  empresaId: string,
  now = new Date(),
): Promise<IntegrityReportBody> {
  const window = hotWindow(now);
  const { byId, objectiveIds } = await loadClientsByEmpresa(db, empresaId);
  const [turnos, slas] = await Promise.all([
    loadHotTurnos(db, empresaId, window.start, window.end),
    loadSlas(db, empresaId),
  ]);
  const extraIds = [
    ...turnos.map((t) => String(t.clientId || '')),
    ...slas.map((s) => String(s.clientId || '')),
  ];
  await hydrateMissingClients(db, byId, extraIds);
  const date = arDateKey(now);
  return scanLoadedEmpresa({
    empresaId,
    date,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    generatedAt: now.toISOString(),
    turnos,
    slas,
    clientsById: byId,
    objectiveIds,
  });
}

export async function persistIntegrityReport(
  db: admin.firestore.Firestore,
  report: IntegrityReportBody,
): Promise<{ reportId: string; novedadCreated: boolean }> {
  const reportId = integrityReportId(report.empresaId, report.date);
  const ref = db.collection('integrity_reports').doc(reportId);
  const prev = await ref.get();
  const prevNovedadId = prev.exists ? String(prev.data()?.novedadId || '') : '';
  await ref.set({
    ...report,
    novedadId: prevNovedadId || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (report.totalFindings <= 0 || prevNovedadId) {
    return { reportId, novedadCreated: false };
  }

  const novedad = await db.collection('novedades').add({
    type: 'INTEGRIDAD_DATOS',
    status: 'pending',
    viewed: false,
    priority: 'medium',
    targetRole: 'SUPERADMIN',
    actionTarget: 'CONFIG',
    title: 'Integridad de datos',
    description: integrityNovedadDescription(reportId, report.counts),
    empresaId: report.empresaId,
    reportId,
    source: 'INTEGRITY_CRON',
    reportedBy: 'SISTEMA',
    createdAt: FieldValue.serverTimestamp(),
  });
  await ref.set({ novedadId: novedad.id }, { merge: true });
  return { reportId, novedadCreated: true };
}

export async function runNightlyIntegrity(
  db: admin.firestore.Firestore,
  now = new Date(),
): Promise<{ empresas: number; withFindings: number }> {
  const empresas = await db.collection('empresas').get();
  let scanned = 0;
  let withFindings = 0;
  for (const emp of empresas.docs) {
    const data = emp.data() as { status?: unknown };
    if (isInactiveEmpresa(data.status)) continue;
    scanned += 1;
    const report = await runIntegrityScanForEmpresa(db, emp.id, now);
    await persistIntegrityReport(db, report);
    if (report.totalFindings > 0) withFindings += 1;
  }
  return { empresas: scanned, withFindings };
}

/** 03:30 hora Argentina. Solo reporta; no corrige turnos ni contratos. */
export const scheduledIntegrityScan = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 540,
    memory: '512MiB',
    region: 'us-central1',
  },
  async () => {
    const result = await runNightlyIntegrity(admin.firestore());
    console.log(
      `[scheduledIntegrityScan] empresas=${result.empresas} conHallazgos=${result.withFindings}`,
    );
  },
);

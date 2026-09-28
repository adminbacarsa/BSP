/**
 * SOLO LECTURA de Firestore de producción.
 * Arma el fixture anonimizado de prefactura (Banco de Córdoba, sept 2026)
 * y mide lecturas/tiempo del Centro de mando de pruebas_sa.
 * No escribe en Firestore.
 *
 *   node scripts/build-banco-sept-fixture.mjs
 * (cwd apps/functions, o NODE_PATH=apps/functions/node_modules)
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../apps/functions/package.json'));
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'comtroldata',
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
const { Timestamp } = admin.firestore;
const EMPRESA = 'pruebas_sa';
const CLIENT_ID = 'IT6iKBUATyhmc1OLMDbc';
const monthStart = new Date('2026-09-01T03:00:00.000Z');
const monthEnd = new Date('2026-10-01T02:59:59.999Z');
const padStart = new Date(monthStart);
const padEnd = new Date(monthEnd);
padStart.setDate(padStart.getDate() - 2);
padEnd.setDate(padEnd.getDate() + 2);
const start = Timestamp.fromDate(padStart);
const end = Timestamp.fromDate(padEnd);

function inMonth(data) {
  const st = data.startTime?.toDate?.() || null;
  const schedule = ymd(data.scheduleDate) || ymd(data.planningDate) || ymd(data.fecha);
  const byStart = st && st >= monthStart && st <= monthEnd;
  const bySchedule = schedule && schedule >= '2026-09-01' && schedule <= '2026-09-30';
  return byStart || bySchedule;
}

function iso(value) {
  if (!value) return undefined;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function ymd(value) {
  const raw = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

const mapOf = () => {
  let n = 0;
  const map = new Map();
  return (prefix, id) => {
    const key = String(id ?? '').trim();
    if (!key) return undefined;
    if (!map.has(key)) {
      n += 1;
      map.set(key, `${prefix}${String(n).padStart(4, '0')}`);
    }
    return map.get(key);
  };
};

async function main() {
  const paintStarted = Date.now();
  const [clientsSnap, balancesSnap, slaSnap, contractsSnap] = await Promise.all([
    db.collection('clients').where('empresaId', '==', EMPRESA).get(),
    db.collection('hours_balances').where('empresaId', '==', EMPRESA).where('periodKey', '==', '2026-09').get(),
    db.collection('servicios_sla').where('empresaId', '==', EMPRESA).get(),
    db.collection('contracts').where('empresaId', '==', EMPRESA).get(),
  ]);
  const paintMs = Date.now() - paintStarted;
  const paintReads = clientsSnap.size + balancesSnap.size + slaSnap.size + contractsSnap.size;
  console.log(`DESPUES pintar: ${paintReads} docs en ${paintMs} ms (clients ${clientsSnap.size}, balances ${balancesSnap.size}, sla ${slaSnap.size}, contracts ${contractsSnap.size}) — 0 turnos`);

  let objectiveCount = 0;
  let nameCount = 0;
  clientsSnap.docs.forEach((d) => {
    const objs = d.data().objetivos || [];
    objs.forEach((o) => {
      if (String(o.id || '').trim()) objectiveCount += 1;
      if (String(o.name || '').trim()) nameCount += 1;
    });
  });
  const oldClientQueries = Math.ceil(clientsSnap.size / 10);
  const oldObjectiveQueries = Math.ceil((objectiveCount + nameCount) / 10);
  console.log(`ANTES plan de lecturas de turnos: clientId x${oldClientQueries} + objectiveId(id+nombre) x${oldObjectiveQueries} + barrido empresa x1 + empleados`);

  const companyStarted = Date.now();
  const company = await db.collection('turnos').where('empresaId', '==', EMPRESA).where('startTime', '>=', Timestamp.fromDate(monthStart)).where('startTime', '<=', Timestamp.fromDate(monthEnd)).count().get();
  const empleados = await db.collection('empleados').where('empresaId', '==', EMPRESA).count().get();
  const downloadStarted = Date.now();
  const companyDocs = await db.collection('turnos').where('empresaId', '==', EMPRESA).where('startTime', '>=', Timestamp.fromDate(monthStart)).where('startTime', '<=', Timestamp.fromDate(monthEnd)).get();
  const onePassMs = Date.now() - downloadStarted;
  console.log(`ANTES volumen: barrido mes ${company.data().count} turnos, una pasada get ${companyDocs.size} docs en ${onePassMs} ms (count ${Date.now() - companyStarted} ms) + empleados ${empleados.data().count}. El codigo viejo repetia el mes 3 veces antes de pintar.`);

  const client = await db.collection('clients').doc(CLIENT_ID).get();
  const ids = (client.data()?.objetivos || []).map((o) => String(o.id || '').trim()).filter(Boolean);
  const turnMap = new Map();
  const queryStarted = Date.now();
  let queries = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    queries += 1;
    const snap = await db.collection('turnos')
      .where('objectiveId', 'in', chunk)
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .get();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (String(data.empresaId || '') !== EMPRESA) return;
      if (!inMonth(data)) return;
      turnMap.set(d.id, data);
    });
  }
  console.log(`DESPUES prefactura Banco: ${queries} consultas objectiveId, ${turnMap.size} turnos de la empresa, ${Date.now() - queryStarted} ms`);

  const turnoId = mapOf();
  const empId = mapOf();
  const objId = mapOf();
  const posId = mapOf();
  const rows = [];
  for (const [id, data] of turnMap) {
    const oid = objId('O', data.objectiveId);
    rows.push({
      id: turnoId('T', id),
      objectiveId: oid,
      objectiveName: oid ? `Objetivo ${oid}` : 'Objetivo',
      positionName: posId('P', data.positionName || 'Sin puesto') || 'Puesto',
      employeeId: empId('E', data.employeeId),
      code: data.code || data.type || '',
      hours: typeof data.hours === 'number' ? data.hours : undefined,
      startTime: iso(data.startTime),
      endTime: iso(data.endTime),
      scheduleDate: ymd(data.scheduleDate),
      planningDate: ymd(data.planningDate),
      fecha: ymd(data.fecha),
      startDate: ymd(data.startDate),
      realStartTime: iso(data.realStartTime),
      realEndTime: iso(data.realEndTime),
      checkInTime: iso(data.checkInTime),
      checkOutTime: iso(data.checkOutTime),
      origin: data.origin || undefined,
      status: data.status || undefined,
      isAbsent: data.isAbsent === true,
      isPresent: data.isPresent === true,
      isCompleted: data.isCompleted === true,
      isDeleted: data.isDeleted === true,
      coverageHoursOnSource: data.coverageHoursOnSource === true,
      coverageSuperseded: data.coverageSuperseded === true,
      absenceShiftId: turnoId('T', data.absenceShiftId),
      coveredShiftId: turnoId('T', data.coveredShiftId),
      titularShiftId: turnoId('T', data.titularShiftId),
      sourceShiftId: turnoId('T', data.sourceShiftId),
      isRetention: data.isRetention === true,
      retentionAbsenceShiftId: turnoId('T', data.retentionAbsenceShiftId),
      retentionKind: data.retentionKind || undefined,
      retentionReleasedAt: iso(data.retentionReleasedAt),
      retentionEndTime: iso(data.retentionEndTime),
    });
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'banco-cordoba-2026-09.anon.json');
  writeFileSync(out, JSON.stringify(rows));
  const withBoth = rows.filter((r) => r.realStartTime && r.realEndTime).length;
  console.log(`fixture ${rows.length} turnos, ${withBoth} con realStart+realEnd → ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Exporta JSON de movimientos automáticos (Demo / IA P0 / cobertura ops) para un día AR.
 * Uso: node scripts/export-ops-automation-audit-day.js <empresaId> <yyyy-mm-dd> [out.json]
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ID = 'comtroldata';

function initAdmin() {
  if (admin.apps.length) return;
  const saPath = path.join(__dirname, '../service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(require(saPath)), projectId: PROJECT_ID });
}

function dayBoundsArUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 0, 0));
  return { start: admin.firestore.Timestamp.fromDate(start), end: admin.firestore.Timestamp.fromDate(end) };
}

async function main() {
  const empresaId = String(process.argv[2] || '').trim();
  const ymd = String(process.argv[3] || '').trim();
  const outPath =
    process.argv[4] ||
    path.join(__dirname, `ops-automation-audit-${empresaId || 'empresa'}-${ymd || 'fecha'}.json`);

  if (!empresaId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    console.error('Uso: node scripts/export-ops-automation-audit-day.js <empresaId> <yyyy-mm-dd> [out.json]');
    process.exit(1);
  }

  initAdmin();
  const db = admin.firestore();
  const { start, end } = dayBoundsArUtc(ymd);

  const [novedadesSnap, runsSnap, turnosDemoSnap] = await Promise.all([
    db
      .collection('novedades')
      .where('empresaId', '==', empresaId)
      .where('createdAt', '>=', start)
      .where('createdAt', '<', end)
      .limit(500)
      .get(),
    db
      .collection('automation_runs')
      .where('empresaId', '==', empresaId)
      .limit(200)
      .get(),
    db
      .collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', start)
      .where('startTime', '<', end)
      .limit(800)
      .get(),
  ]);

  const novedades = novedadesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => {
      const origin = String(n.origin || '');
      const type = String(n.type || '');
      const reported = String(n.reportedBy || n.source || '');
      return (
        origin === 'AUTOMATION_P0' ||
        type.startsWith('IA_ALERTA_') ||
        reported === 'MODO_DEMO' ||
        n.source === 'MODO_DEMO' ||
        n.modoDemoAt
      );
    })
    .map((n) => ({
      id: n.id,
      type: n.type,
      origin: n.origin,
      status: n.status,
      title: n.title,
      description: n.description,
      shiftId: n.shiftId,
      employeeId: n.employeeId,
      employeeName: n.employeeName,
      objectiveId: n.objectiveId,
      objectiveName: n.objectiveName,
      automationFingerprint: n.automationFingerprint,
      createdAt: n.createdAt?.toDate?.()?.toISOString?.() || null,
    }));

  const runs = runsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => {
      const created = r.createdAt?.toDate?.();
      if (!created) return true;
      return created >= start.toDate() && created < end.toDate();
    })
    .map((r) => ({
      id: r.id,
      type: r.type,
      runId: r.runId,
      notes: r.notes,
      createdAt: r.createdAt?.toDate?.()?.toISOString?.() || null,
    }));

  const turnosDemo = turnosDemoSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (t) =>
        t.modoDemoAt ||
        t.source === 'MODO_DEMO' ||
        t.absenceDetectedBy === 'MODO_DEMO' ||
        t.resolvedBy === 'MODO_DEMO',
    )
    .map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employeeName,
      objectiveId: t.objectiveId,
      objectiveName: t.objectiveName,
      code: t.code,
      origin: t.origin,
      isAbsent: t.isAbsent,
      isPresent: t.isPresent,
      absenceShiftId: t.absenceShiftId,
      startTime: t.startTime?.toDate?.()?.toISOString?.() || null,
      endTime: t.endTime?.toDate?.()?.toISOString?.() || null,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    empresaId,
    dayArgentina: ymd,
    summary: {
      novedadesAutomatizadas: novedades.length,
      automationRuns: runs.length,
      turnosModoDemo: turnosDemo.length,
    },
    novedades,
    automationRuns: runs,
    turnosModoDemo: turnosDemo,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`OK → ${outPath}`);
  console.log(JSON.stringify(payload.summary));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Exporta JSON de movimientos automáticos (Demo / IA P0 / cobertura ops) para un día AR.
 * Uso: node scripts/export-ops-automation-audit-day.js <empresaId> <yyyy-mm-dd> [out.json]
 *
 * No requiere índices compuestos extra: si falla la query con rango, filtra en memoria por empresaId.
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
  return {
    start: admin.firestore.Timestamp.fromDate(start),
    end: admin.firestore.Timestamp.fromDate(end),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function fieldTimestampMs(data, field) {
  const value = data[field];
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return null;
}

function docTimeMsForDayFilter(data) {
  const candidates = ['createdAt', 'detectedAt', 'atendidaAt'];
  for (const key of candidates) {
    const ms = fieldTimestampMs(data, key);
    if (ms != null) return ms;
  }
  return null;
}

function inDayWindow(data, startMs, endMs) {
  const ms = docTimeMsForDayFilter(data);
  if (ms == null) return false;
  return ms >= startMs && ms < endMs;
}

function isIndexError(err) {
  const code = err && err.code;
  const details = String(err && err.details ? err.details : err && err.message ? err.message : '');
  return code === 9 || details.includes('requires an index');
}

/**
 * Query con rango de tiempo; fallback a empresaId + filtro en memoria (sin índice compuesto).
 */
async function queryPendingIaNovedades(db, empresaId) {
  const mapDoc = (d) => {
    const n = { id: d.id, ...d.data() };
    return {
      id: n.id,
      type: n.type,
      origin: n.origin,
      status: n.status,
      shiftId: n.shiftId,
      employeeId: n.employeeId,
      employeeName: n.employeeName,
      objectiveId: n.objectiveId,
      objectiveName: n.objectiveName,
      automationFingerprint: n.automationFingerprint,
      description: n.description,
      createdAt: n.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  };

  const belongs = (data) => {
    const eid = String(data.empresaId || '').trim();
    return !eid || eid === empresaId;
  };

  try {
    const snap = await db
      .collection('novedades')
      .where('origin', '==', 'AUTOMATION_P0')
      .where('status', '==', 'pending')
      .limit(250)
      .get();
    return snap.docs.filter((d) => belongs(d.data())).map(mapDoc);
  } catch (err) {
    if (!isIndexError(err)) throw err;
  }

  try {
    const snap = await db.collection('novedades').where('status', '==', 'pending').limit(400).get();
    return snap.docs
      .filter((d) => {
        const data = d.data();
        if (!belongs(data)) return false;
        const type = String(data.type || '');
        return data.origin === 'AUTOMATION_P0' || type.startsWith('IA_ALERTA_');
      })
      .map(mapDoc);
  } catch (err) {
    if (!isIndexError(err)) throw err;
    return [];
  }
}

async function queryEmpresaInTimeWindow(db, collectionName, empresaId, timeField, start, end, limitIndexed, limitFallback) {
  const startMs = start.toMillis();
  const endMs = end.toMillis();
  const base = db.collection(collectionName).where('empresaId', '==', empresaId);

  try {
    const snap = await base
      .where(timeField, '>=', start)
      .where(timeField, '<', end)
      .limit(limitIndexed)
      .get();
    return { docs: snap.docs, mode: 'indexed_range' };
  } catch (err) {
    if (!isIndexError(err)) throw err;
  }

  const snap = await base.limit(limitFallback).get();
  const docs = snap.docs.filter((d) => {
    const ms = fieldTimestampMs(d.data(), timeField);
    if (ms == null) return false;
    return ms >= startMs && ms < endMs;
  });
  return { docs, mode: 'empresaId_scan_filter', scanned: snap.size, matched: docs.length };
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return null;
}

/** Mini ficha de turno para auditar alertas sin abrir Firestore a mano. */
function shiftSnapshot(shiftId, data) {
  if (!data) {
    return { id: shiftId, missing: true };
  }
  return {
    id: shiftId,
    missing: false,
    empresaId: data.empresaId ?? null,
    employeeId: data.employeeId ?? null,
    employeeName: data.employeeName ?? null,
    objectiveId: data.objectiveId ?? null,
    objectiveName: data.objectiveName ?? null,
    positionName: data.positionName ?? null,
    code: data.code ?? null,
    origin: data.origin ?? null,
    draft: data.draft === true,
    isVirtual: data.isVirtual === true,
    isFranco: data.isFranco === true,
    isAbsent: data.isAbsent === true,
    isPresent: data.isPresent === true,
    isCompleted: data.isCompleted === true,
    isUnassigned: data.isUnassigned === true,
    absenceShiftId: data.absenceShiftId ?? null,
    coveredShiftId: data.coveredShiftId ?? null,
    resolvedBy: data.resolvedBy ?? null,
    startTime: timestampIso(data.startTime),
    endTime: timestampIso(data.endTime),
    modoDemoAt: timestampIso(data.modoDemoAt),
    source: data.source ?? null,
    absenceDetectedBy: data.absenceDetectedBy ?? null,
  };
}

function relatedShiftIdsFromNovedad(n) {
  const ids = new Set();
  const primary = String(n.shiftId || '').trim();
  if (primary) ids.add(primary);

  const fp = String(n.automationFingerprint || '').trim();
  if (fp.startsWith('overlap__')) {
    const parts = fp.split('__');
    if (parts.length >= 3) {
      ids.add(parts[1]);
      ids.add(parts[2]);
    }
  } else if (fp.startsWith('absence_uncovered__')) {
    ids.add(fp.slice('absence_uncovered__'.length));
  } else if (fp.startsWith('late_checkin__')) {
    ids.add(fp.slice('late_checkin__'.length));
  } else if (fp.startsWith('expired_open_shift__')) {
    ids.add(fp.slice('expired_open_shift__'.length));
  } else if (fp.startsWith('long_shift__')) {
    ids.add(fp.slice('long_shift__'.length));
  }

  return [...ids].filter(Boolean);
}

async function loadTurnosByIds(db, shiftIds) {
  const unique = [...new Set(shiftIds.filter(Boolean))];
  const map = new Map();
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const refs = chunk.map((id) => db.collection('turnos').doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      map.set(snap.id, snap.exists ? snap.data() : null);
    }
  }
  return map;
}

function enrichNovedadWithShiftContext(n, shiftMap) {
  const relatedShiftIds = relatedShiftIdsFromNovedad(n);
  const shifts = {};
  for (const id of relatedShiftIds) {
    shifts[id] = shiftSnapshot(id, shiftMap.get(id));
  }

  let overlapPair = null;
  const fp = String(n.automationFingerprint || '');
  if (fp.startsWith('overlap__')) {
    const parts = fp.split('__');
    if (parts.length >= 3) {
      const shiftAId = parts[1];
      const shiftBId = parts[2];
      overlapPair = {
        shiftAId,
        shiftBId,
        shiftA: shifts[shiftAId] ?? shiftSnapshot(shiftAId, shiftMap.get(shiftAId)),
        shiftB: shifts[shiftBId] ?? shiftSnapshot(shiftBId, shiftMap.get(shiftBId)),
      };
    }
  }

  return {
    ...n,
    relatedShiftIds,
    shifts,
    overlapPair,
  };
}

function buildSolapamientosResumen(novedadesEnriquecidas) {
  const byFingerprint = new Map();
  for (const n of novedadesEnriquecidas) {
    if (String(n.type || '') !== 'IA_ALERTA_SOLAPAMIENTO_TURNOS') continue;
    const fp = String(n.automationFingerprint || '').trim();
    if (!fp || byFingerprint.has(fp)) continue;
    byFingerprint.set(fp, {
      automationFingerprint: fp,
      status: n.status,
      employeeId: n.employeeId,
      employeeName: n.employeeName,
      description: n.description,
      novedadIds: [],
      overlapPair: n.overlapPair,
    });
  }
  for (const n of novedadesEnriquecidas) {
    if (String(n.type || '') !== 'IA_ALERTA_SOLAPAMIENTO_TURNOS') continue;
    const fp = String(n.automationFingerprint || '').trim();
    const row = byFingerprint.get(fp);
    if (row) row.novedadIds.push(n.id);
  }
  return [...byFingerprint.values()];
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
  const { start, end, startMs, endMs } = dayBoundsArUtc(ymd);

  const [novedadesResult, runsSnap, turnosResult, pendingIa] = await Promise.all([
    queryEmpresaInTimeWindow(db, 'novedades', empresaId, 'createdAt', start, end, 500, 4000),
    db.collection('automation_runs').where('empresaId', '==', empresaId).limit(200).get(),
    queryEmpresaInTimeWindow(db, 'turnos', empresaId, 'startTime', start, end, 800, 3500),
    queryPendingIaNovedades(db, empresaId),
  ]);

  if (novedadesResult.mode !== 'indexed_range') {
    console.warn(
      `[audit] novedades: sin índice empresaId+createdAt → leídos ${novedadesResult.scanned ?? '?'}, en ventana del día ${novedadesResult.matched ?? novedadesResult.docs.length}`,
    );
  }
  if (turnosResult.mode !== 'indexed_range') {
    console.warn(
      `[audit] turnos: fallback empresaId → ${turnosResult.docs.length} turnos en ventana del día`,
    );
  }

  const novedades = novedadesResult.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => inDayWindow(n, startMs, endMs))
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
      detectedAt: n.detectedAt?.toDate?.()?.toISOString?.() || null,
    }));

  const runs = runsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => {
      const created = r.createdAt?.toDate?.();
      if (!created) return true;
      return created.getTime() >= startMs && created.getTime() < endMs;
    })
    .map((r) => ({
      id: r.id,
      type: r.type,
      runId: r.runId,
      notes: r.notes,
      createdAt: r.createdAt?.toDate?.()?.toISOString?.() || null,
    }));

  const turnosDemo = turnosResult.docs
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

  const allNovedadRows = [...novedades, ...pendingIa];
  const shiftIdsToLoad = allNovedadRows.flatMap((n) => relatedShiftIdsFromNovedad(n));
  const shiftMap = await loadTurnosByIds(db, shiftIdsToLoad);

  const novedadesEnriquecidas = novedades.map((n) => enrichNovedadWithShiftContext(n, shiftMap));
  const pendingIaEnriquecidas = pendingIa.map((n) => enrichNovedadWithShiftContext(n, shiftMap));
  const solapamientosResumen = buildSolapamientosResumen(novedadesEnriquecidas);

  const turnosReferenciados = {};
  for (const id of new Set(shiftIdsToLoad)) {
    turnosReferenciados[id] = shiftSnapshot(id, shiftMap.get(id));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    empresaId,
    dayArgentina: ymd,
    queryModes: {
      novedades: novedadesResult.mode,
      turnos: turnosResult.mode,
    },
    summary: {
      novedadesAutomatizadas: novedades.length,
      iaPendingAbiertas: pendingIa.length,
      automationRuns: runs.length,
      turnosModoDemo: turnosDemo.length,
      turnosReferenciadosEnAlertas: Object.keys(turnosReferenciados).length,
      solapamientosDistintos: solapamientosResumen.length,
    },
    solapamientosResumen,
    turnosReferenciados,
    novedades: novedadesEnriquecidas,
    iaPendingAbiertas: pendingIaEnriquecidas,
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

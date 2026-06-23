/**
 * fix-turno-endtime.js
 * Corrige el endTime de turnos guardados con duración incorrecta (8h en vez del horario real).
 * Usa el SLA del objetivo para determinar el endTime correcto por código de turno.
 *
 * Uso:
 *   node scripts/fix-turno-endtime.js --objective-id <ID>  [--dry-run] [--desde YYYY-MM-DD] [--hasta YYYY-MM-DD]
 *
 * Opciones:
 *   --objective-id   ID del objetivo (obligatorio)
 *   --dry-run        Solo muestra qué cambiaría, sin escribir
 *   --desde          Fecha inicio (ej. 2026-06-01) — default: inicio del mes actual
 *   --hasta          Fecha fin   (ej. 2026-06-30) — default: fin del mes actual
 *
 * Requiere service-account.json en la raíz del proyecto.
 */

const path = require('path');
const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}
const db = getFirestore();

// ── Argumentos ────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const DRY    = args.includes('--dry-run');
const objIdx = args.indexOf('--objective-id');
const desdeIdx = args.indexOf('--desde');
const hastaIdx = args.indexOf('--hasta');

if (objIdx === -1 || !args[objIdx + 1]) {
  console.error('❌  Falta --objective-id <ID>');
  process.exit(1);
}
const OBJECTIVE_ID = args[objIdx + 1];

const now      = new Date();
const y        = now.getFullYear();
const m        = now.getMonth();
const desdeStr = desdeIdx !== -1 ? args[desdeIdx + 1] : `${y}-${String(m + 1).padStart(2, '0')}-01`;
const hastaStr = hastaIdx !== -1 ? args[hastaIdx + 1] : `${y}-${String(m + 1).padStart(2, '0')}-${new Date(y, m + 1, 0).getDate()}`;

function parseDate(s) {
  const [yy, mm, dd] = s.split('-').map(Number);
  return new Date(yy, mm - 1, dd);
}
const DESDE = parseDate(desdeStr);
const HASTA = parseDate(hastaStr); HASTA.setHours(23, 59, 59);

// ── Helpers ───────────────────────────────────────────────────────────────────
function tsToDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v.seconds != null) return new Date(v.seconds * 1000);
  return null;
}

function parseHM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: +m[1], min: +m[2] };
}

function fmtDate(d) {
  if (!d) return '?';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtTime(d) {
  if (!d) return '?';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/**
 * Calcula el endTime esperado dado un startTime (Date) y la definición del turno del SLA.
 * Retorna un Date o null si no se puede determinar.
 */
function computeExpectedEnd(startDate, shDef) {
  if (!startDate || !shDef) return null;

  const hrs = Number(shDef.hours);
  const endHM = parseHM(shDef.endTime ?? shDef.end);

  if (endHM) {
    const e = new Date(startDate);
    e.setHours(endHM.h, endHM.min, 0, 0);
    if (e > startDate) return e;

    // endTime cae igual o antes del start:
    // Si el turno es corto (< 8h según SLA), probablemente el guardia llegó tarde
    // y el startTime real es >= SLA endTime. Usar hours como duración.
    if (hrs > 0 && hrs < 8) {
      return new Date(startDate.getTime() + hrs * 3600000);
    }
    // Caso nocturno (N, N12): sumar 24h
    e.setTime(e.getTime() + 24 * 3600000);
    return e;
  }

  if (hrs > 0) {
    return new Date(startDate.getTime() + hrs * 3600000);
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${DRY ? '🔍 DRY RUN — solo reporte' : '🔧 FIX ENDTIME — PRODUCCIÓN'}`);
  console.log(`   Objetivo : ${OBJECTIVE_ID}`);
  console.log(`   Rango    : ${desdeStr} → ${hastaStr}\n`);

  // 1. Obtener SLA(s) del objetivo — solo los que solapan con el rango solicitado
  console.log('Leyendo SLA del objetivo…');
  const slaSnap = await db.collection('servicios_sla')
    .where('objectiveId', '==', OBJECTIVE_ID)
    .get();

  if (slaSnap.empty) {
    console.error('❌  No se encontró ningún SLA para este objetivo.');
    process.exit(1);
  }

  // Filtrar SLAs que solapan con el rango y ordenar del más antiguo al más reciente
  // (el más reciente gana en caso de conflicto de código en la misma posición)
  const safeDateFromSla = v => {
    try {
      if (!v) return null;
      if (v.toDate) return v.toDate();
      if (typeof v === 'string') return new Date(v);
      if (v.seconds != null) return new Date(v.seconds * 1000);
      return null;
    } catch { return null; }
  };
  const activeSlas = slaSnap.docs
    .map(d => ({ id: d.id, data: d.data(), startDate: safeDateFromSla(d.data().startDate), endDate: safeDateFromSla(d.data().endDate) }))
    .filter(({ startDate, endDate }) => {
      // Incluir si el SLA solapa con el rango DESDE..HASTA
      if (!startDate && !endDate) return true; // sin fechas → siempre incluir
      const slaStart = startDate || new Date(0);
      const slaEnd   = endDate   || new Date(9999, 0);
      return slaStart <= HASTA && slaEnd >= DESDE;
    })
    .sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0));

  if (activeSlas.length === 0) {
    console.warn('⚠️  Ningún SLA activo en el rango solicitado — usando todos los SLAs del objetivo.');
    activeSlas.push(...slaSnap.docs.map(d => ({ id: d.id, data: d.data() })));
  }

  // Construir mapa por SLA (para lookup por fecha de turno)
  // slaShiftMaps[i] = { sla, shiftMap }
  const slaShiftMaps = activeSlas.map(({ id, data, startDate, endDate }) => {
    const map = {};
    const positions = Array.isArray(data.positions) ? data.positions : Object.values(data.positions || {});
    for (const pos of positions) {
      const posName = String(pos.name ?? pos.positionName ?? 'General');
      const shifts  = Array.isArray(pos.allowedShiftTypes) ? pos.allowedShiftTypes
                    : Array.isArray(pos.shifts)            ? pos.shifts : [];
      for (const sh of shifts) {
        const code = String(sh.code || '').toUpperCase();
        if (!code) continue;
        map[`${posName}::${code}`] = sh;
        if (!map[`::${code}`]) map[`::${code}`] = sh;
      }
    }
    return { id, startDate, endDate, map };
  });

  // Helper: dado un Date de turno, devuelve el shiftDef más apropiado.
  // Solo usa match posición+código exacto; no cae al genérico ::código para evitar
  // aplicar horario de otra posición (ej. M de Hall Central a turnos de Rondin).
  function lookupShift(turnoDate, posName, code) {
    const codeUp = String(code || '').toUpperCase();
    const keys = posName ? [`${posName}::${codeUp}`] : [`::${codeUp}`];
    for (const s of [...slaShiftMaps].reverse()) {
      const sStart = s.startDate || new Date(0);
      const sEnd   = s.endDate   || new Date(9999, 0);
      if (turnoDate >= sStart && turnoDate <= sEnd) {
        for (const k of keys) { if (s.map[k]) return s.map[k]; }
      }
    }
    // Fallback sin restricción de fecha
    for (const s of [...slaShiftMaps].reverse()) {
      for (const k of keys) { if (s.map[k]) return s.map[k]; }
    }
    return null;
  }

  const allCodes = [...new Set(slaShiftMaps.flatMap(s => Object.keys(s.map).map(k => k.split('::')[1])))];
  console.log(`   SLA(s) activos: ${activeSlas.length}/${slaSnap.size} — ${allCodes.length} código(s): ${allCodes.join(', ')}\n`);

  // 2. Leer turnos del objetivo en el rango de fechas
  console.log('Leyendo turnos…');
  const turnosSnap = await db.collection('turnos')
    .where('objectiveId', '==', OBJECTIVE_ID)
    .where('startTime', '>=', Timestamp.fromDate(DESDE))
    .where('startTime', '<=', Timestamp.fromDate(HASTA))
    .get();

  console.log(`   ${turnosSnap.size} turnos encontrados en el rango\n`);

  // 3. Analizar y preparar fixes
  const toFix = [];
  let ok = 0;
  let noSla = 0;
  let franco = 0;

  const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'PG', 'AA', 'RET']);

  for (const doc of turnosSnap.docs) {
    const t     = doc.data();
    const code  = String(t.code || t.type || '').toUpperCase();
    const posName = String(t.positionName || 'General');

    if (FRANCO_CODES.has(code)) { franco++; continue; }

    const startDate = tsToDate(t.startTime);
    const endDate   = tsToDate(t.endTime);
    if (!startDate || !endDate) { noSla++; continue; }

    // Buscar definición en SLA vigente a la fecha del turno
    const shDef = lookupShift(startDate, posName, code);
    if (!shDef) { noSla++; continue; }

    const expectedEnd = computeExpectedEnd(startDate, shDef);
    if (!expectedEnd) { noSla++; continue; }

    // Solo corregir si el endTime actual parece el fallback de 8h (±10 min)
    // Esto evita tocar presencias operativas o turnos guardados con horarios reales
    const eightHoursEnd = new Date(startDate.getTime() + 8 * 3600000);
    const isLikelyBug = Math.abs(endDate.getTime() - eightHoursEnd.getTime()) <= 10 * 60000;
    if (!isLikelyBug) { ok++; continue; }

    // Comparar con tolerancia de 1 minuto
    const diffMin = Math.abs(expectedEnd.getTime() - endDate.getTime()) / 60000;
    if (diffMin < 1) { ok++; continue; }

    toFix.push({
      id: doc.id,
      emp: t.employeeName || t.employeeId || '?',
      code,
      posName,
      fecha: fmtDate(startDate),
      startStr: fmtTime(startDate),
      endActual: fmtTime(endDate),
      endEsperado: fmtTime(expectedEnd),
      expectedEndTs: Timestamp.fromDate(expectedEnd),
    });
  }

  console.log(`Resumen:`);
  console.log(`  ✅ Correctos    : ${ok}`);
  console.log(`  ⚠️  Sin SLA/skip : ${noSla}`);
  console.log(`  🚫 Francos/Lic  : ${franco}`);
  console.log(`  🔧 A corregir   : ${toFix.length}\n`);

  if (toFix.length === 0) {
    console.log('Nada que corregir.');
    return;
  }

  // Mostrar detalle de los primeros 30
  const preview = toFix.slice(0, 30);
  console.log('Cambios a aplicar (primeros 30):');
  console.log('  Fecha      Empleado                  Código   Puesto                Actual  → Corregido');
  console.log('  ' + '─'.repeat(90));
  for (const f of preview) {
    const emp  = f.emp.padEnd(24).slice(0, 24);
    const pos  = f.posName.padEnd(20).slice(0, 20);
    const code = f.code.padEnd(6);
    console.log(`  ${f.fecha}  ${emp}  ${code}  ${pos}  ${f.startStr}–${f.endActual}  →  ${f.startStr}–${f.endEsperado}`);
  }
  if (toFix.length > 30) console.log(`  ... y ${toFix.length - 30} más`);

  if (DRY) {
    console.log('\n🔍 DRY RUN — no se escribió nada. Quitá --dry-run para aplicar.');
    return;
  }

  // 4. Batch update
  console.log(`\nAplicando ${toFix.length} correcciones…`);
  const CHUNK = 400;
  let updated = 0;
  for (let i = 0; i < toFix.length; i += CHUNK) {
    const batch = db.batch();
    toFix.slice(i, i + CHUNK).forEach(f => {
      batch.update(db.collection('turnos').doc(f.id), {
        endTime: f.expectedEndTs,
      });
    });
    await batch.commit();
    updated += Math.min(CHUNK, toFix.length - i);
    process.stdout.write(`\r  ${updated}/${toFix.length}`);
  }
  console.log(`\n\n✅ ${updated} turnos corregidos.`);
}

run().catch(e => { console.error(e); process.exit(1); });

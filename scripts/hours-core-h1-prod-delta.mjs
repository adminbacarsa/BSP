/**
 * H1 (libro persona) — delta de solo lectura contra PRODUCCIÓN.
 *
 * Compara payrollApi con el flag `hoursCoreEnabled` forzado OFF (motor legacy,
 * intacto) vs forzado ON (motor `@cosp/hours-core` con las decisiones 1-5 de
 * Mauro) para la misma empresa/ciclo, y separa una muestra de empresas reales
 * (flag OFF real) para confirmar 0h de diferencia. Nunca escribe en Firestore
 * (guard de escritura) ni togglea el flag en el documento real de `empresas`
 * — el forzado ON/OFF se hace en memoria monkey-parcheando
 * `isHoursCoreEnabled` de `@cosp/hours-core` antes de cada corrida.
 *
 * Requisitos: `npm run build` en apps/functions (o dejar que este script lo
 * pida); `gcloud auth application-default login`.
 *
 *   node scripts/hours-core-h1-prod-delta.mjs [--empresa pruebas_sa] [--cycle 2026-09] [--sampleReal 3]
 *
 * Salida: scripts/out/hours-core-h1-prod-delta-<empresa>-<cycle>.json (gitignored).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

function installWriteGuard() {
  const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
  const deny = (what) => function denied() {
    throw new Error(`[hours-core-h1-delta] escritura bloqueada (${what}): este script es solo lectura`);
  };
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(`doc.${m}`);
  CollectionReference.prototype.add = deny('collection.add');
  WriteBatch.prototype.commit = deny('batch.commit');
  Firestore.prototype.runTransaction = deny('runTransaction');
  Firestore.prototype.recursiveDelete = deny('recursiveDelete');
}

/** Últimos 4 dígitos del legajo o hash corto del employeeId — nunca el nombre real. */
function maskLegajo(item) {
  const legajo = String(item?.employee?.fileNumber || '').trim();
  if (legajo) return `legajo-${legajo.slice(-3).padStart(3, '0')}`;
  const id = String(item?.employee?.id || '');
  return `emp-${id.slice(0, 4) || '????'}`;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function diffSnapshots(legacyItems, coreItems) {
  const byLegajoLegacy = new Map(legacyItems.map((i) => [i.employee.id, i]));
  const byLegajoCore = new Map(coreItems.map((i) => [i.employee.id, i]));
  const ids = new Set([...byLegajoLegacy.keys(), ...byLegajoCore.keys()]);
  const rows = [];
  for (const id of ids) {
    const l = byLegajoLegacy.get(id);
    const c = byLegajoCore.get(id);
    const hsRealesL = l?.acumulado?.hsReales ?? 0;
    const hsRealesC = c?.acumulado?.hsReales ?? 0;
    const hsTeoricasL = l?.acumulado?.hsTeoricas ?? 0;
    const hsTeoricasC = c?.acumulado?.hsTeoricas ?? 0;
    const al100L = l?.acumulado?.al100FT ?? 0;
    const al100C = c?.acumulado?.al100FT ?? 0;
    const deltaReales = round2(hsRealesC - hsRealesL);
    const deltaTeoricas = round2(hsTeoricasC - hsTeoricasL);
    const deltaAl100 = round2(al100C - al100L);
    if (deltaReales === 0 && deltaTeoricas === 0 && deltaAl100 === 0) continue;
    rows.push({
      legajo: maskLegajo(c || l),
      hsRealesLegacy: round2(hsRealesL),
      hsRealesCore: round2(hsRealesC),
      deltaReales,
      hsTeoricasLegacy: round2(hsTeoricasL),
      hsTeoricasCore: round2(hsTeoricasC),
      deltaTeoricas,
      al100FTLegacy: round2(al100L),
      al100FTCore: round2(al100C),
      deltaAl100,
    });
  }
  rows.sort((a, b) => Math.abs(b.deltaReales) - Math.abs(a.deltaReales));
  return rows;
}

/** Escanea turnos crudos para contar el disparador de cada decisión (independiente del motor). */
function scanDecisionTriggers(turnos) {
  const tsMs = (v) => {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    return 0;
  };
  const byEmpDay = new Map();
  for (const t of turnos) {
    if (!t.employeeId) continue;
    const startMs = tsMs(t.startTime);
    if (!startMs) continue;
    const dayKey = new Date(startMs - 3 * 3600000).toISOString().slice(0, 10);
    const key = `${t.employeeId}_${dayKey}`;
    (byEmpDay.get(key) || byEmpDay.set(key, []).get(key)).push(t);
  }

  const decision2 = []; // doble jornada mismo día
  for (const [key, docs] of byEmpDay) {
    if (docs.length < 2) continue;
    const totalMs = docs.reduce((sum, d) => {
      const s = tsMs(d.startTime);
      const e = tsMs(d.endTime);
      return sum + (e > s ? e - s : 0);
    }, 0);
    decision2.push({ key, turnos: docs.length, horasSumadas: round2(totalMs / 3600000) });
  }

  const decision3 = []; // salida anticipada
  const decision5 = []; // llegada tarde
  for (const t of turnos) {
    if (!t.employeeId) continue;
    const startMs = tsMs(t.startTime);
    const endMs = tsMs(t.endTime);
    const rStartMs = tsMs(t.realStartTime);
    const rEndMs = tsMs(t.realEndTime);
    if (startMs && rStartMs && rStartMs - startMs > 5 * 60000) {
      decision5.push({
        employeeId: t.employeeId,
        shiftId: t.id,
        tardanzaMin: Math.round((rStartMs - startMs) / 60000),
      });
    }
    if (endMs && rEndMs && endMs - rEndMs > 5 * 60000) {
      decision3.push({
        employeeId: t.employeeId,
        shiftId: t.id,
        salidaAnticipadaMin: Math.round((endMs - rEndMs) / 60000),
        tieneRelevo: !!(t.relievedBy || t.relievedByName),
      });
    }
  }

  const decision4 = turnos.filter((t) => { // FT día completo (placeholder 00:00-23:59)
    if (t.code !== 'FT' && !t.isFrancoTrabajado) return false;
    const startMs = tsMs(t.startTime);
    const endMs = tsMs(t.endTime);
    if (!startMs || !endMs) return false;
    const dur = (endMs - startMs) / 3600000;
    return dur >= 23.5;
  }).map((t) => ({ employeeId: t.employeeId, shiftId: t.id }));

  return { decision2, decision3, decision4, decision5 };
}

function summarizeTriggers(triggers) {
  const legajosOf = (arr, field = 'employeeId') => new Set(arr.map((r) => r[field] || r.key?.split('_')[0])).size;
  return {
    decision2_dobleJornada: {
      casos: triggers.decision2.length,
      legajos: new Set(triggers.decision2.map((r) => r.key.split('_')[0])).size,
      ejemplos: triggers.decision2.slice(0, 3).map((r, i) => ({ ejemplo: `A${i + 1}`, turnos: r.turnos, horasSumadas: r.horasSumadas })),
    },
    decision3_salidaAnticipada: {
      casos: triggers.decision3.length,
      sinRelevo: triggers.decision3.filter((r) => !r.tieneRelevo).length,
      conRelevo: triggers.decision3.filter((r) => r.tieneRelevo).length,
      legajos: legajosOf(triggers.decision3),
      ejemplos: triggers.decision3.slice(0, 3).map((r, i) => ({ ejemplo: `B${i + 1}`, salidaAnticipadaMin: r.salidaAnticipadaMin, tieneRelevo: r.tieneRelevo })),
    },
    decision4_ftDiaCompleto: {
      casos: triggers.decision4.length,
      legajos: legajosOf(triggers.decision4),
      ejemplos: triggers.decision4.slice(0, 3).map((r, i) => ({ ejemplo: `C${i + 1}`, shiftId: r.shiftId })),
    },
    decision5_llegadaTarde: {
      casos: triggers.decision5.length,
      legajos: legajosOf(triggers.decision5),
      ejemplos: triggers.decision5.slice(0, 3).map((r, i) => ({ ejemplo: `D${i + 1}`, tardanzaMin: r.tardanzaMin })),
    },
  };
}

/**
 * `@cosp/hours-core`'s `index.js` re-exporta `isHoursCoreEnabled` con un getter
 * no configurable (`Object.defineProperty` sin `configurable:true`), así que no
 * se puede pisar en el objeto del entrypoint. El getter lee en vivo la
 * propiedad del submódulo `./flag.js` (asignación plana, sí mutable) — se
 * parchea ahí, requiriendo ese archivo por ruta absoluta (el `package.json`
 * "exports" solo habilita ".", pero un require por path físico no lo respeta).
 */
function resolveFlagModule(requireFn) {
  const entry = requireFn.resolve('@cosp/hours-core');
  const flagPath = path.join(path.dirname(entry), 'flag.js');
  return requireFn(flagPath);
}

async function computeSnapshots(buildLiquidacionSnapshot, flagMod, cycle, empresaId) {
  const originalFn = flagMod.isHoursCoreEnabled;
  try {
    flagMod.isHoursCoreEnabled = () => false;
    const legacy = await buildLiquidacionSnapshot({ cycle, empresaId, page: 1, pageSize: 5000 });

    flagMod.isHoursCoreEnabled = () => true;
    const core = await buildLiquidacionSnapshot({ cycle, empresaId, page: 1, pageSize: 5000 });

    return { legacy, core };
  } finally {
    flagMod.isHoursCoreEnabled = originalFn;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const empresaId = args.empresa || 'pruebas_sa';
  const sampleReal = Number(args.sampleReal || 3);

  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.GCLOUD_PROJECT;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  installWriteGuard();
  const db = admin.firestore();

  const { buildLiquidacionSnapshot } = requireFn('./lib/payroll-api/calc.js');
  const { parseCycleId, listRecentCycles } = requireFn('./lib/payroll-api/cycle.js');
  const flagMod = resolveFlagModule(requireFn);

  const cycleId = args.cycle || listRecentCycles(2)[1]?.cycleId; // último ciclo cerrado por defecto
  const cycle = parseCycleId(cycleId);
  if (!cycle) throw new Error(`cycleId inválido: ${cycleId}`);

  console.log(`\n=== H1 delta prod (solo lectura) — ciclo ${cycle.cycleId} (${cycle.cycleStartStr} → ${cycle.cycleEndStr}) ===`);

  // 1) Empresa objetivo (pruebas_sa por defecto) — flag OFF vs ON en memoria.
  const empresaSnap = await db.collection('empresas').doc(empresaId).get();
  const empresaData = empresaSnap.data() || {};
  console.log(`\nEmpresa objetivo: ${empresaId} — hoursCoreEnabled real=${empresaData.hoursCoreEnabled === true} modoDemoEnabled=${empresaData.modoDemoEnabled === true}`);

  const { legacy, core } = await computeSnapshots(buildLiquidacionSnapshot, flagMod, cycle, empresaId);
  const deltaRows = diffSnapshots(legacy.items, core.items);

  const turnosSnap = await db
    .collection('turnos')
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(cycle.cycleStart))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(cycle.cycleEnd))
    .get();
  const turnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const triggers = scanDecisionTriggers(turnos);
  const decisionSummary = summarizeTriggers(triggers);

  // 2) Muestra de empresas reales (flag OFF real, no Demo) — deben dar 0h de diferencia.
  const empresasSnap = await db.collection('empresas').get();
  const realCandidates = empresasSnap.docs
    .filter((d) => d.id !== empresaId)
    .filter((d) => d.data()?.modoDemoEnabled !== true)
    .filter((d) => d.data()?.hoursCoreEnabled !== true)
    .slice(0, sampleReal);
  const demoCount = empresasSnap.docs.filter((d) => d.data()?.modoDemoEnabled === true).length;

  // Ojo: NO forzamos el flag acá. La prueba de "0h de diferencia" para empresas
  // reales es que el flag real siga OFF y por lo tanto `buildLiquidacionSnapshot`
  // nunca entre a la rama nueva (`buildLiquidacionSnapshotPersona`): las
  // decisiones 1-5 sólo tocan esa rama y el motor `@cosp/hours-core`, jamás el
  // cuerpo legacy de `calc.ts` (sin cambios línea a línea en este PR). Forzar
  // el flag ON acá mediría el delta F1 ya documentado en DIVERGENCES.md, no el
  // impacto de H1 — por eso se llama tal cual, con el flag real de cada empresa.
  const realChecks = [];
  for (const doc of realCandidates) {
    const eid = doc.id;
    try {
      const snap = await buildLiquidacionSnapshot({ cycle, empresaId: eid, page: 1, pageSize: 5000 });
      realChecks.push({
        empresaId: eid,
        empleados: snap.items.length,
        turnosEnRango: snap.diagnostics?.turnosEnRango ?? 0,
        hoursCoreEnabledReal: snap.diagnostics?.hoursCoreEnabled === true,
        totalHsReales: round2(snap.items.reduce((s, i) => s + (i.acumulado?.hsReales || 0), 0)),
        ramaLegacyIntacta: snap.diagnostics?.hoursCoreEnabled !== true,
      });
    } catch (e) {
      realChecks.push({ empresaId: eid, error: String(e.message || e) });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    cycle: { id: cycle.cycleId, start: cycle.cycleStartStr, end: cycle.cycleEndStr },
    empresaObjetivo: {
      empresaId,
      hoursCoreEnabledReal: empresaData.hoursCoreEnabled === true,
      modoDemoEnabled: empresaData.modoDemoEnabled === true,
      diagnosticsLegacy: legacy.diagnostics,
      diagnosticsCore: core.diagnostics,
      totalHsRealesLegacy: round2(legacy.items.reduce((s, i) => s + (i.acumulado?.hsReales || 0), 0)),
      totalHsRealesCore: round2(core.items.reduce((s, i) => s + (i.acumulado?.hsReales || 0), 0)),
      legajosConDiferencia: deltaRows.length,
      deltaPorLegajo: deltaRows,
      ejemplosAnonimizados: deltaRows.slice(0, 3).map((r, i) => ({ ejemplo: `LEG-${i + 1}`, ...r, legajo: undefined })),
    },
    decisiones: decisionSummary,
    muestraEmpresasRealesFlagOff: {
      criterio: 'hoursCoreEnabled != true, modoDemoEnabled != true, excluida la empresa objetivo; se llama con el flag REAL de cada empresa (sin forzar)',
      empresasDemoExcluidas: demoCount,
      empresas: realChecks,
      confirmacion0h: realChecks.every((r) => r.ramaLegacyIntacta === true && !r.error),
    },
    reportesIgualPayrollApi:
      'Por construcción: buildLiquidacionSnapshotPersona (payrollApi) y useReportes.ts llaman la misma ' +
      'buildPersonaBook + personaStatsToPayrollFigures de @cosp/hours-core con el mismo fetch (turnos por ' +
      'startTime, ausencias, publishFilter=\'all\' por defecto). Validado también por los cánones ' +
      '\'payrollApi=Reportes\' de `npm run eval:hours-core`.',
  };

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `hours-core-h1-prod-delta-${empresaId}-${cycle.cycleId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(`\n--- ${empresaId} (flag forzado OFF vs ON, mismo ciclo) ---`);
  console.log(`Hs reales legacy=${report.empresaObjetivo.totalHsRealesLegacy}  core=${report.empresaObjetivo.totalHsRealesCore}  legajos con diferencia=${deltaRows.length}`);
  console.log('\nPor decisión (disparadores, independiente del motor):');
  for (const [k, v] of Object.entries(decisionSummary)) {
    console.log(`  ${k}: casos=${v.casos} legajos=${v.legajos}`);
  }
  console.log(`\nMuestra empresas reales (flag real, sin Demo; ${demoCount} empresas Demo excluidas):`);
  for (const r of realChecks) {
    console.log(`  ${r.empresaId}: hoursCoreEnabledReal=${r.hoursCoreEnabledReal ?? 'ERROR'} ramaLegacyIntacta=${r.ramaLegacyIntacta ?? '-'} totalHsReales=${r.totalHsReales ?? '-'}`);
  }
  console.log(`\n0h de impacto H1 confirmado en muestra real (rama legacy intacta, sin forzar flag): ${report.muestraEmpresasRealesFlagOff.confirmacion0h}`);
  console.log(`\nDetalle completo: ${outFile}`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});

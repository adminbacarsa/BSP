/**
 * Eventual en un evento: ausencia a T+30 → el operador revierte → se paga la jornada, el AT vuelve
 * URGENTE, no queda falta en desempeño, la novedad se cierra y la tarjeta queda presente.
 * Con reemplazo ya aceptado, revertir exige elegir (COVERAGE_IN_PROGRESS) y liberar al reemplazo.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-revertir "node scripts/eval-ev-revertir-eventual-emulator.mjs"
 * Antes: npm run build en apps/functions.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ev-revertir' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { revertirAusenciaShift } = requireFn('./lib/attendance/revertirAusencia.js');
const { applyCoverage } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const EMP = 'pruebas_sa';
const CUIL = '20333444559';

async function seedEventual(suffix) {
  const shiftId = `ev_${suffix}`;
  const contratoId = `ctr_${suffix}`;
  const atId = `at_${suffix}`;
  const start = Timestamp.fromMillis(Date.now() - 35 * 60000);
  const end = Timestamp.fromMillis(Date.now() + 7 * 3600000);
  await db.collection('turnos').doc(shiftId).set({
    empresaId: EMP, clientId: 'cli', clientName: 'Cliente', objectiveId: 'evt_pumas', objectiveName: 'pumas',
    positionName: 'puerta campus', code: 'EV', type: 'Evento', origin: 'EVENTO',
    eventoId: 'pumas', eventoNombre: 'pumas', servicioId: 'srv', servicioNombre: 'puerta campus',
    employeeId: `emp_${suffix}`, employeeName: 'Aballay Rolon, Luciano',
    esEventual: true, bolsaCuil: CUIL, eventualContratoId: contratoId, eventualAltaArcaConfirmada: false,
    startTime: start, endTime: end, scheduleDate: '2026-10-02', hours: 8, status: 'PENDING', isPresent: false, draft: false,
  });
  await db.collection('contratos_eventuales').doc(contratoId).set({
    empresaId: EMP, bolsaCuil: CUIL, employeeId: `emp_${suffix}`, estado: 'CONFIRMADO', status: 'ACTIVE',
    fechaAlta: '2026-10-02', fechaBaja: '2026-10-02',
    jornadas: [{ fecha: '2026-10-02', horaInicio: '12:00', horaFin: '20:00', horas: 8 }],
  });
  await db.collection('arca_envios').doc(atId).set({
    empresaId: EMP, contratoIds: [contratoId], bolsaCuil: CUIL, tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', quitadoDelLote: false,
  });
  await db.collection('solicitudes_evento').doc(`sol_${suffix}`).set({
    empresaId: EMP, eventoId: 'pumas', servicioId: 'srv', empleadoId: `emp_${suffix}`, empleadoNombre: 'Aballay Rolon, Luciano',
    status: 'aprobada', esEventual: true, bolsaCuil: CUIL, turnoId: shiftId, contratoId, anexoEstado: 'FIRMADO', anexoId: 'anexo_x',
    jornada: { fecha: '2026-10-02', horaInicio: '12:00', horaFin: '20:00', horas: 8 },
  });
  return { shiftId, contratoId, atId };
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ nombre: 'Pruebas', centroControlEnabled: true });
  await db.collection('eventuales_bolsa').doc(CUIL).set({ cuil: CUIL, nombre: 'Aballay Rolon, Luciano', status: 'ACTIVE', uid: 'uid-ab' });

  // ── Caso 1: falta a T+30 y después el operador revierte ──
  const a = await seedEventual('a');
  const marked = await markShiftAbsent(db, a.shiftId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  let t = (await db.collection('turnos').doc(a.shiftId).get()).data();
  let at = (await db.collection('arca_envios').doc(a.atId).get()).data();
  const falta = await db.collection('guardia_desempeno_eventos').doc(`FALTA_SIN_AVISO_${a.shiftId}_${CUIL}`).get();
  const novAbs = await db.collection('novedades').where('shiftId', '==', a.shiftId).where('type', '==', 'AUSENCIA_EVENTUAL').get();
  report(
    'T+30: AA, no se paga, AT fuera del lote, falta en desempeño, novedad',
    marked.applied === true && t.isAbsent === true && t.pagaJornada === false && !!t.eventualNoSePresentoAt
      && at.quitadoDelLote === true && falta.exists && novAbs.size === 1,
    `paga=${t.pagaJornada} at=${at.quitadoDelLote} falta=${falta.exists} nov=${novAbs.size}`,
  );

  const rev = await revertirAusenciaShift(db, { shiftId: a.shiftId, operatorUid: 'uid-op' });
  t = (await db.collection('turnos').doc(a.shiftId).get()).data();
  at = (await db.collection('arca_envios').doc(a.atId).get()).data();
  const ctr = (await db.collection('contratos_eventuales').doc(a.contratoId).get()).data();
  const faltaDespues = await db.collection('guardia_desempeno_eventos').doc(`FALTA_SIN_AVISO_${a.shiftId}_${CUIL}`).get();
  const tarde = await db.collection('guardia_desempeno_eventos').doc(`LLEGADA_TARDE_SIN_AVISO_${a.shiftId}_${CUIL}`).get();
  const novCerrada = (await db.collection('novedades').where('shiftId', '==', a.shiftId).where('type', '==', 'AUSENCIA_EVENTUAL').get()).docs[0]?.data();
  const sol = (await db.collection('solicitudes_evento').doc('sol_a').get()).data();
  report(
    'revertir: presente, se paga, sin marcas de falta',
    rev.success === true && t.isPresent === true && t.isAbsent === false && t.status === 'PRESENT' && t.pagaJornada === true
      && t.noSePresento === undefined && t.eventualNoSePresentoAt === undefined && !!t.eventualNoSePresentoRevertidoAt
      && !(t.excluirBolsaCuils || []).includes(CUIL) && t.isSinCobertura === false && t.employeeName === 'Aballay Rolon, Luciano',
    `present=${t.isPresent} paga=${t.pagaJornada} late=${t.lateMinutes}`,
  );
  report(
    'revertir: AT vuelve al lote como URGENTE',
    at.quitadoDelLote === false && at.canal === 'URGENTE' && at.estado === 'PENDIENTE' && !!at.reencoladoAt && t.eventualArcaReversion === 'AT_REENCOLADO',
    `quitado=${at.quitadoDelLote} canal=${at.canal}`,
  );
  report(
    'revertir: contrato CONFIRMADO con la jornada, anexo firmado se mantiene',
    ctr.estado === 'CONFIRMADO' && (ctr.jornadas || []).length === 1 && ctr.cierre === undefined && sol.anexoEstado === 'FIRMADO' && sol.noSePresento === false,
    `estado=${ctr.estado} jornadas=${(ctr.jornadas || []).length} anexo=${sol.anexoEstado}`,
  );
  report(
    'revertir: la falta se borra y queda llegada tarde con reversión',
    !faltaDespues.exists && tarde.exists && tarde.data().revertidaDesdeFalta === true && tarde.data().lateMinutes >= 30,
    `falta=${faltaDespues.exists} tarde=${tarde.exists} min=${tarde.data()?.lateMinutes}`,
  );
  report(
    'revertir: novedad AUSENCIA_EVENTUAL atendida con nota',
    novCerrada?.status === 'ATENDIDA' && /Ausencia revertida/.test(String(novCerrada?.reversionNota || '')),
    `status=${novCerrada?.status}`,
  );
  const audit = await db.collection('audit_logs').where('turnoId', '==', a.shiftId).where('action', '==', 'EVENTUAL_AUSENCIA_REVERTIDA').get();
  report('revertir: audit_logs', audit.size === 1, `n=${audit.size}`);

  // Volver a marcarlo ausente no corre dos veces la falta sobre un presente (idempotencia de la reversión).
  const otra = await markShiftAbsent(db, a.shiftId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  report('un presente no vuelve a AA por el automático', otra.applied === false, `applied=${otra.applied}`);

  // ── Caso 2: ya aceptó un reemplazo (cobertura del hueco de evento, origin EVENTO) ──
  const b = await seedEventual('b');
  await markShiftAbsent(db, b.shiftId, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  await db.collection('turnos').doc('src_ref_b').set({
    empresaId: EMP, objectiveId: 'evt_pumas', positionName: 'puerta campus', code: 'REF',
    employeeId: 'emp_ref', employeeName: 'Refuerzo',
    startTime: Timestamp.fromMillis(Date.now() - 35 * 60000), endTime: Timestamp.fromMillis(Date.now() + 7 * 3600000), status: 'PENDING',
  });
  const batch = db.batch();
  const covId = await applyCoverage(db, batch, {
    titularShiftId: b.shiftId, candidateEmployeeId: 'emp_ref', candidateEmployeeName: 'Refuerzo',
    sourceShiftId: 'src_ref_b', coverageType: 'REF', resolvedBy: 'AUTO', empresaId: EMP, titularCloseMode: 'FULL',
  });
  await batch.commit();
  const cov = (await db.collection('turnos').doc(covId).get()).data();
  const tb = (await db.collection('turnos').doc(b.shiftId).get()).data();
  report('reemplazo aceptado: cobertura origin EVENTO vinculada al titular', cov.origin === 'EVENTO' && cov.absenceShiftId === b.shiftId && tb.coveredByEmployeeName === 'Refuerzo', `origin=${cov.origin} cubre=${tb.coveredByEmployeeName}`);

  const sinElegir = await revertirAusenciaShift(db, { shiftId: b.shiftId, operatorUid: 'uid-op' });
  report('con reemplazo: revertir sin elegir se frena (COVERAGE_IN_PROGRESS)', sinElegir.success === false && sinElegir.reason === 'COVERAGE_IN_PROGRESS', sinElegir.reason || '');

  const liberar = await revertirAusenciaShift(db, { shiftId: b.shiftId, operatorUid: 'uid-op', cancelCoverage: true });
  const covDespues = (await db.collection('turnos').doc(covId).get()).data();
  const tbDespues = (await db.collection('turnos').doc(b.shiftId).get()).data();
  const atB = (await db.collection('arca_envios').doc(b.atId).get()).data();
  report(
    'liberar al reemplazo: cobertura cancelada, titular presente y pagado, AT urgente',
    liberar.success === true && covDespues.status === 'CANCELLED' && covDespues.coverageSuperseded === true
      && tbDespues.isPresent === true && tbDespues.pagaJornada === true && tbDespues.operacionallyCovered === false
      && atB.quitadoDelLote === false && atB.canal === 'URGENTE',
    `cov=${covDespues.status} present=${tbDespues.isPresent} at=${atB.canal}`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `FALLARON ${failed}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });

/**
 * Backlog «Retención — pendiente».
 * (a) FIFO: el primer entrante que ficha libera al retenido que más tiempo lleva.
 *     El tope 12:59 manda si esa fichada cae después.
 * (b) A T+0 la cobertura es el relevo: si ya fichó, cierra; si no, retiene hasta que fiche.
 * (c) El compañero que sigue en el puesto no sale de ACTIVOS
 *     (relevo parcial, dos salientes y un entrante, entrante que ficha y se va).
 *
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ret-fifo "node scripts/eval-retencion-fifo-pendientes-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { register } from 'node:module';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ret-fifo' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { classifyOpsShift } = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/classifyOpsShift.ts')).href);
const { shiftMatchesOpsViewTab } = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/shiftMatchesOpsViewTab.ts')).href);

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const DAY = '2026-10-06';
const ar = (h, min) => Timestamp.fromDate(new Date(`${DAY}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));
const iso = (h, min) => `${DAY}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`;
const CAP_MS = (12 * 60 + 59) * 60 * 1000;

const ctx = {
  isEnabled: () => true,
  isDemo: () => false,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

const present = (extra) => ({ status: 'PRESENT', isPresent: true, isCompleted: false, isAbsent: false, ...extra });

async function seedBase(prefix, { positions, shifts }) {
  const oid = `${prefix}_obj`;
  const empresaId = `${prefix}_emp`;
  const clientId = `${prefix}_cli`;
  await db.collection('servicios_sla').doc(`${prefix}_sla`).set({
    empresaId,
    objectiveId: oid,
    clientId,
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    positions,
  });
  await db.collection('planificacion_estados').doc(`${empresaId}_${oid}_2026_10`).set({
    empresaId, objectiveId: oid, year: 2026, month: 10, publishedAt: Timestamp.now(),
  });
  await db.collection('clients').doc(clientId).set({ empresaId, status: 'ACTIVE', nombre: 'Cliente' });
  const base = { empresaId, objectiveId: oid, objectiveName: 'Peaje 9 Norte', clientId, positionName: 'Puesto 2' };
  const batch = db.batch();
  for (const [key, row] of Object.entries(shifts)) {
    batch.set(db.collection('turnos').doc(`${prefix}_${key}`), { ...base, ...row });
  }
  await batch.commit();
  const id = (key) => `${prefix}_${key}`;
  return { id, oid, empresaId };
}

const get = async (docId) => {
  const snap = await db.collection('turnos').doc(docId).get();
  return { id: docId, ...(snap.data() || {}) };
};

function enActivos(row, nowMs) {
  const start = row.startTime?.toDate?.() || new Date(nowMs);
  const end = row.endTime?.toDate?.() || new Date(nowMs);
  const classified = classifyOpsShift({
    shift: { ...row, shiftDateObj: start, endDateObj: end },
    now: new Date(nowMs),
    isValidEmployee: !!row.employeeId && row.employeeId !== 'VACANTE',
    isFranco: false,
    shiftCode: row.code,
    effectiveEndDateObj: end,
  });
  return shiftMatchesOpsViewTab({ ...classified, isFranco: false }, 'ACTIVOS', new Date(nowMs));
}

const bandas2 = [{
  name: 'Puesto 2', quantity: 2, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  allowedShiftTypes: [
    { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 2 },
    { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 2 },
  ],
}];

function parM(prefix) {
  return {
    viejo: {
      ...present({
        employeeId: `${prefix}_viejo`, employeeName: 'VIEJO, ANA', code: 'M',
        startTime: ar(7, 0), endTime: ar(15, 0),
        checkInAt: ar(7, 0), realStartTime: ar(7, 0),
      }),
    },
    nuevo: {
      ...present({
        employeeId: `${prefix}_nuevo`, employeeName: 'NUEVO, LUIS', code: 'M',
        startTime: ar(7, 0), endTime: ar(15, 0),
        checkInAt: ar(9, 0), realStartTime: ar(9, 0),
      }),
    },
    primero: {
      employeeId: `${prefix}_primero`, employeeName: 'PRIMERO, SARA', code: 'T', status: 'PENDING',
      startTime: ar(15, 0), endTime: ar(23, 0),
    },
    segundo: {
      employeeId: `${prefix}_segundo`, employeeName: 'SEGUNDO, JUAN', code: 'T', status: 'PENDING',
      startTime: ar(15, 0), endTime: ar(23, 0),
    },
  };
}

/** (a) Fichada: el primer T libera al que más tiempo lleva, no al más nuevo. */
async function casoFichadaFifo() {
  const prefix = 'a_fichada';
  const { id } = await seedBase(prefix, { positions: bandas2, shifts: parM(prefix) });
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const antes = await Promise.all([get(id('viejo')), get(id('nuevo'))]);
  report('a fichada: los dos M quedan retenidos', antes.every((r) => r.isRetention === true && r.isCompleted !== true),
    `viejo=${antes[0].isRetention} nuevo=${antes[1].isRetention}`);

  const r = await registrarPresencia(db, {
    shiftId: id('primero'), source: 'PORTAL_GPS', empId: `${prefix}_primero`, recordedAt: iso(15, 10),
  });
  const viejo = await get(id('viejo'));
  const nuevo = await get(id('nuevo'));
  report('a fichada: PRIMERO libera a VIEJO (más tiempo), no a NUEVO',
    r.relieved?.shiftId === id('viejo')
    && viejo.isCompleted === true
    && viejo.isRetention !== true
    && viejo.relievedBy === `${prefix}_primero`
    && nuevo.isCompleted !== true
    && nuevo.isRetention === true
    && !nuevo.relievedBy,
    `relieved=${r.relieved?.shiftId} viejo←${viejo.relievedBy || '-'} ret=${viejo.isRetention} nuevo ret=${nuevo.isRetention} by=${nuevo.relievedBy || '-'}`);
  report('c dos salientes y un entrante: NUEVO sigue en ACTIVOS',
    enActivos(nuevo, ar(15, 12).toMillis()) && !enActivos(viejo, ar(15, 12).toMillis()),
    `nuevo=${enActivos(nuevo, ar(15, 12).toMillis())} viejo=${enActivos(viejo, ar(15, 12).toMillis())}`);
}

/** (a) Cron con el entrante ya presente: cierra al más antiguo. */
async function casoCronFifo() {
  const prefix = 'a_cron';
  const { id } = await seedBase(prefix, { positions: bandas2, shifts: parM(prefix) });
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  await db.collection('turnos').doc(id('primero')).update({
    status: 'PRESENT', isPresent: true, checkInAt: ar(15, 10), realStartTime: ar(15, 0),
  });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 12));
  const viejo = await get(id('viejo'));
  const nuevo = await get(id('nuevo'));
  const actV = res.actions.find((a) => a.shiftId === id('viejo'));
  const actN = res.actions.find((a) => a.shiftId === id('nuevo'));
  report('a cron: cierra a VIEJO por relevo y NUEVO sigue retenido',
    actV?.kind === 'CLOSE' && viejo.relievedBy === `${prefix}_primero` && viejo.isRetention !== true
    && nuevo.isCompleted !== true && nuevo.isRetention === true && actN?.kind !== 'CLOSE',
    `viejo=${actV?.kind}/${actV?.reason} nuevo=${actN?.kind || 'WAIT'}/${nuevo.retentionReason || ''}`);
}

/** (a) Tope: la fichada posterior a las 12:59 cierra al más antiguo en el tope, no a la hora del punch. */
async function casoTopeFichada() {
  const prefix = 'a_tope_f';
  const { id } = await seedBase(prefix, { positions: bandas2, shifts: parM(prefix) });
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const capViejo = ar(7, 0).toMillis() + CAP_MS;
  await registrarPresencia(db, {
    shiftId: id('primero'), source: 'OPERATIONS', empId: `${prefix}_primero`, recordedAt: iso(20, 10),
  });
  const viejo = await get(id('viejo'));
  const nuevo = await get(id('nuevo'));
  const end = viejo.realEndTime?.toMillis?.() ?? 0;
  report('a tope fichada: VIEJO cierra en el tope 12:59 (19:59), motivo TOPE, NUEVO sigue',
    viejo.isCompleted === true
    && viejo.isRetention !== true
    && end === capViejo
    && viejo.completionReason === 'TOPE_JORNADA'
    && nuevo.isCompleted !== true
    && nuevo.isRetention === true,
    `end=${end} cap=${capViejo} reason=${viejo.completionReason} ret=${viejo.isRetention} nuevo ret=${nuevo.isRetention} nuevoDone=${nuevo.isCompleted}`);
}

/** (a) El cron, con el entrante ya adentro pasado el tope, hace lo mismo. */
async function casoTopeCron() {
  const prefix = 'a_tope_c';
  const { id } = await seedBase(prefix, { positions: bandas2, shifts: parM(prefix) });
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  await db.collection('turnos').doc(id('primero')).update({
    status: 'PRESENT', isPresent: true, checkInAt: ar(20, 10), realStartTime: ar(15, 0),
  });
  const capViejo = ar(7, 0).toMillis() + CAP_MS;
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(20, 12));
  const viejo = await get(id('viejo'));
  const nuevo = await get(id('nuevo'));
  const actV = res.actions.find((a) => a.shiftId === id('viejo'));
  report('a tope cron: VIEJO TOPE_JORNADA a las 19:59 y NUEVO sigue retenido',
    actV?.reason === 'TOPE_JORNADA'
    && viejo.realEndTime?.toMillis?.() === capViejo
    && viejo.isRetention !== true
    && nuevo.isCompleted !== true
    && nuevo.isRetention === true,
    `viejo=${actV?.reason} end=${viejo.realEndTime?.toMillis?.()} ret=${viejo.isRetention} nuevoDone=${nuevo.isCompleted}`);
}

const banda1 = [{
  name: 'Puesto 2', quantity: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  allowedShiftTypes: [
    { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
    { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
  ],
}];

function salienteSolo(prefix, titularExtra) {
  return {
    sal: {
      ...present({
        employeeId: `${prefix}_sal`, employeeName: 'SALIENTE, MARIO', code: 'M',
        startTime: ar(7, 0), endTime: ar(15, 0),
        checkInAt: ar(7, 10), realStartTime: ar(7, 10),
      }),
    },
    tit: {
      employeeId: `${prefix}_tit`, employeeName: 'TITULAR, ROSA', code: 'T',
      status: 'ABSENT', isAbsent: true, isPresent: false,
      startTime: ar(15, 0), endTime: ar(23, 0),
      ...titularExtra,
    },
  };
}

/** (b) Cobertura presente a T+0: no se retiene; el saliente lo releva el cubridor. */
async function casoCoberturaPresente() {
  const prefix = 'b_pres';
  const { id } = await seedBase(prefix, { positions: banda1, shifts: salienteSolo(prefix, {}) });
  await db.collection('turnos').doc(id('cub')).set({
    empresaId: `${prefix}_emp`, objectiveId: `${prefix}_obj`, positionName: 'Puesto 2',
    employeeId: `${prefix}_cub`, employeeName: 'CUBRE, ANA', code: 'T',
    origin: 'OPERATIONS_COVERAGE', coverageType: 'FT', status: 'PRESENT', isPresent: true,
    isAbsent: false, isCompleted: false,
    startTime: ar(15, 0), endTime: ar(23, 0),
    absenceShiftId: id('tit'), checkInAt: ar(15, 2), realStartTime: ar(15, 0),
  });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const sal = await get(id('sal'));
  const act = res.actions.find((a) => a.shiftId === id('sal'));
  report('b presente: no retiene; el cubridor releva al saliente',
    sal.isRetention !== true && sal.isCompleted === true && sal.relievedBy === `${prefix}_cub` && act?.kind !== 'RETAIN',
    `kind=${act?.kind}/${act?.reason} ret=${sal.isRetention} done=${sal.isCompleted} by=${sal.relievedBy || '-'}`);
}

/** (b) Cobertura confirmada y el cubridor todavía no fichó: retención hasta que fiche. */
async function casoCoberturaConfirmada() {
  const prefix = 'b_conf';
  const { id } = await seedBase(prefix, {
    positions: banda1,
    shifts: salienteSolo(prefix, { operacionallyCovered: true, coverageStatus: 'COVERED', coveredByEmployeeId: `${prefix}_cub` }),
  });
  await db.collection('turnos').doc(id('cub')).set({
    empresaId: `${prefix}_emp`, objectiveId: `${prefix}_obj`, positionName: 'Puesto 2',
    employeeId: `${prefix}_cub`, employeeName: 'CUBRE, ANA', code: 'T',
    origin: 'OPERATIONS_COVERAGE', coverageType: 'FT', status: 'PENDING', isPresent: false,
    isAbsent: false, isCompleted: false,
    startTime: ar(15, 0), endTime: ar(23, 0),
    absenceShiftId: id('tit'),
  });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const sal = await get(id('sal'));
  const act = res.actions.find((a) => a.shiftId === id('sal'));
  const started = sal.retentionStartedAt?.toMillis?.() ?? 0;
  report('b confirmada sin fichar: retiene desde el fin, «en camino»',
    sal.isRetention === true
    && sal.isCompleted !== true
    && sal.isPresent === true
    && started === ar(15, 0).toMillis()
    && sal.retentionReason === 'Esperando a CUBRE (cobertura, en camino)'
    && act?.kind === 'RETAIN'
    && enActivos(sal, ar(15, 6).toMillis()),
    `kind=${act?.kind}/${act?.reason} ret=${sal.isRetention} why=${sal.retentionReason || ''} started=${started}`);

  const r = await registrarPresencia(db, {
    shiftId: id('cub'), source: 'OPERATIONS', empId: `${prefix}_cub`, recordedAt: iso(15, 20),
  });
  const sal2 = await get(id('sal'));
  report('b fichada del cubridor: releva al retenido, minutos y fin',
    r.relieved?.shiftId === id('sal')
    && sal2.isCompleted === true
    && sal2.isRetention !== true
    && sal2.relievedBy === `${prefix}_cub`
    && sal2.retentionEndedAt?.toMillis?.() === ar(15, 20).toMillis()
    && Number(sal2.retentionMinutes) === 20,
    `relieved=${r.relieved?.shiftId || '-'} by=${sal2.relievedBy || '-'} ret=${sal2.isRetention} min=${sal2.retentionMinutes} end=${sal2.retentionEndedAt?.toMillis?.() || 0}`);
}

/** (b) Cobertura que entra más tarde: retenido con «llega HH:MM». */
async function casoCoberturaFutura() {
  const prefix = 'b_fut';
  const { id } = await seedBase(prefix, {
    positions: banda1,
    shifts: salienteSolo(prefix, { operacionallyCovered: true, coverageStatus: 'COVERED', coveredByEmployeeName: 'KOPP Franco Isaias' }),
  });
  await db.collection('turnos').doc(id('cub')).set({
    empresaId: `${prefix}_emp`, objectiveId: `${prefix}_obj`, positionName: 'Puesto 2',
    employeeId: `${prefix}_cub`, employeeName: 'KOPP Franco Isaias', code: 'T',
    origin: 'OPERATIONS_COVERAGE', coverageType: 'FT', status: 'PENDING', isPresent: false,
    isAbsent: false, isCompleted: false,
    startTime: ar(16, 0), endTime: ar(23, 0),
    absenceShiftId: id('tit'),
  });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const sal = await get(id('sal'));
  const act = res.actions.find((a) => a.shiftId === id('sal'));
  report('b cobertura futura: retiene y dice llega 16:00',
    sal.isRetention === true
    && sal.isCompleted !== true
    && sal.retentionStartedAt?.toMillis?.() === ar(15, 0).toMillis()
    && sal.retentionReason === 'Esperando a KOPP (cobertura, llega 16:00)'
    && act?.kind === 'RETAIN',
    `kind=${act?.kind}/${act?.reason} why=${sal.retentionReason || ''} ret=${sal.isRetention}`);
}

/** (b) Sin cobertura: sí se retiene. */
async function casoSinCobertura() {
  const prefix = 'b_no';
  const { id } = await seedBase(prefix, { positions: banda1, shifts: salienteSolo(prefix, {}) });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  const sal = await get(id('sal'));
  const act = res.actions.find((a) => a.shiftId === id('sal'));
  report('b sin cobertura: retiene al saliente',
    sal.isRetention === true && sal.isCompleted !== true && (act?.kind === 'RETAIN' || act?.kind === 'RETAIN_QUIET'),
    `kind=${act?.kind}/${act?.reason} ret=${sal.isRetention}`);
}

/** (c) Relevo parcial: un entrante no saca al otro saliente de ACTIVOS. El que ficha y se va tampoco. */
async function casoCompanero() {
  const prefix = 'c_parc';
  const { id } = await seedBase(prefix, { positions: bandas2, shifts: parM(prefix) });
  await db.collection('turnos').doc(id('primero')).update({ coverageStatus: 'PARTIAL' });
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 5));
  await registrarPresencia(db, {
    shiftId: id('primero'), source: 'PORTAL_GPS', empId: `${prefix}_primero`, recordedAt: iso(15, 10),
  });
  let nuevo = await get(id('nuevo'));
  let primero = await get(id('primero'));
  report('c relevo parcial: el compañero sigue presente y en ACTIVOS',
    nuevo.isPresent === true && nuevo.isCompleted !== true && enActivos(nuevo, ar(15, 20).toMillis())
    && primero.isPresent === true && enActivos(primero, ar(15, 20).toMillis()),
    `nuevo present=${nuevo.isPresent} done=${nuevo.isCompleted} act=${enActivos(nuevo, ar(15, 20).toMillis())} entrante act=${enActivos(primero, ar(15, 20).toMillis())}`);

  await db.collection('turnos').doc(id('primero')).update({
    isPresent: false, isCompleted: true, status: 'COMPLETED', realEndTime: ar(16, 0), completionReason: 'CHECKOUT',
  });
  await runAutoCompletarTurnosPass(db, ctx, ar(16, 5));
  nuevo = await get(id('nuevo'));
  primero = await get(id('primero'));
  report('c entrante que ficha y se va: el compañero sigue en ACTIVOS',
    nuevo.isPresent === true && nuevo.isCompleted !== true && nuevo.isRetention === true
    && enActivos(nuevo, ar(16, 6).toMillis())
    && !enActivos(primero, ar(16, 6).toMillis()),
    `nuevo present=${nuevo.isPresent} done=${nuevo.isCompleted} ret=${nuevo.isRetention} act=${enActivos(nuevo, ar(16, 6).toMillis())}`);
}

await casoFichadaFifo();
await casoCronFifo();
await casoTopeFichada();
await casoTopeCron();
await casoCoberturaPresente();
await casoCoberturaConfirmada();
await casoCoberturaFutura();
await casoSinCobertura();
await casoCompanero();

const failed = results.filter((r) => !r.ok);
console.log(`\nretencion fifo pendientes ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('Fallaron:');
  for (const row of failed) console.log(` - ${row.name}`);
  process.exit(1);
}

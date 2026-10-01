/**
 * Relevo FIFO — caso real prod pruebas_sa 01/10/2026, Peaje 9 Norte, Puesto 2.
 * M×2 11:30–15:15: FERRERO (ingresó 11:38) y BOSIO (12:05). T×2 15:15: LOPEZ y BRIZUELA.
 * El primer T que ficha releva al M que más tiempo lleva (FERRERO); el segundo al otro.
 * Variante: ficha primero BRIZUELA aunque la tarjeta lo emparejaba con BOSIO.
 *
 * Emulador aislado (no el lab :8080):
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-fifo "node scripts/eval-relevo-fifo-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-fifo' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const fnSeries = requireFn('./lib/common/shiftSeries.js');
const core = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/shiftSeries.ts')).href);
const { buildRetentionWaitInfo } = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/retentionDisplay.ts')).href);

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const ar = (h, min) => Timestamp.fromDate(new Date(`2026-10-01T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));
const arSec = (h, min, sec) => Timestamp.fromDate(new Date(`2026-10-01T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}-03:00`));
const iso = (h, min) => `2026-10-01T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`;
const END = ar(15, 15);

const ctx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

const present = (extra) => ({ status: 'PRESENT', isPresent: true, isCompleted: false, isAbsent: false, ...extra });

async function seed(prefix) {
  const oid = `${prefix}_peaje`;
  await db.collection('servicios_sla').doc(`${prefix}_sla`).set({
    objectiveId: oid, clientId: `${prefix}_cli`, status: 'active', startDate: '2026-01-01', endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 2', quantity: 2, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', startTime: '11:30', endTime: '15:15', hours: 8, quantity: 2 },
        { code: 'T', startTime: '15:15', endTime: '23:15', hours: 8, quantity: 2 },
      ],
    }],
  });
  const base = { empresaId: `${prefix}_emp`, objectiveId: oid, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2' };
  const id = (k) => `${prefix}_${k}`;
  await db.batch()
    .set(db.collection('turnos').doc(id('ferrero')), { ...base, ...present({ employeeId: 'e_ferrero', employeeName: 'FERRERO, KEVIN', code: 'M', startTime: ar(11, 30), endTime: END, checkInAt: ar(11, 38), realStartTime: ar(11, 38), lateMinutes: 8 }) })
    .set(db.collection('turnos').doc(id('bosio')), { ...base, ...present({ employeeId: 'e_bosio', employeeName: 'BOSIO, ARIEL', code: 'M', startTime: ar(11, 30), endTime: END, checkInAt: ar(12, 5), realStartTime: ar(12, 5), lateMinutes: 35 }) })
    .set(db.collection('turnos').doc(id('lopez')), { ...base, employeeId: 'e_lopez', employeeName: 'LOPEZ, HECTOR', code: 'T', status: 'PENDING', startTime: END, endTime: ar(23, 15) })
    .set(db.collection('turnos').doc(id('brizuela')), { ...base, employeeId: 'e_brizuela', employeeName: 'BRIZUELA, FERNANDO', code: 'T', status: 'PENDING', startTime: END, endTime: ar(23, 15) })
    .commit();
  return id;
}

const get = async (docId) => ({ id: docId, ...((await db.collection('turnos').doc(docId).get()).data() || {}) });
const all = async (id) => Promise.all(['ferrero', 'bosio', 'lopez', 'brizuela'].map((k) => get(id(k))));
const waitFor = (rows, key, nowMs) => buildRetentionWaitInfo(rows.find((r) => r.id.endsWith(`_${key}`)), rows, nowMs);

/** Caso A: ficha primero LOPEZ (15:21) y después BRIZUELA (15:25). */
async function casoA() {
  const id = await seed('fa');

  // 15:15 → los dos M quedan retenidos y vinculados a un T distinto cada uno.
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 15));
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 20));
  let rows = await all(id);
  const [ferrero0, bosio0] = rows;
  report('A 15:15 FERRERO y BOSIO retenidos', ferrero0.isRetention === true && bosio0.isRetention === true && !ferrero0.realEndTime && !bosio0.realEndTime,
    `ferrero=${ferrero0.retentionReason} bosio=${bosio0.retentionReason}`);
  const linkF = String(ferrero0.retentionAbsenceShiftId || '');
  const linkB = String(bosio0.retentionAbsenceShiftId || '');
  report('A vínculos distintos (uno por T)', linkF && linkB && linkF !== linkB && [id('lopez'), id('brizuela')].includes(linkF) && [id('lopez'), id('brizuela')].includes(linkB), `ferrero→${linkF} bosio→${linkB}`);

  // Tarjetas antes de que fiche nadie: cada uno espera al T de su vínculo, sin «ya fichó».
  const wf0 = waitFor(rows, 'ferrero', ar(15, 20).toMillis());
  const wb0 = waitFor(rows, 'bosio', ar(15, 20).toMillis());
  report('A tarjetas 15:20 muestran el mismo par que el servidor', wf0?.reliever?.id === linkF && wb0?.reliever?.id === linkB && !wf0.waitLabel.includes('ya fichó') && !wb0.waitLabel.includes('ya fichó'),
    `ferrero: ${wf0?.waitLabel} | bosio: ${wb0?.waitLabel}`);

  // 15:21 ficha LOPEZ → releva a FERRERO (el que más tiempo lleva), aunque la tarjeta lo tuviera con BOSIO.
  const r1 = await registrarPresencia(db, { shiftId: id('lopez'), source: 'PORTAL_GPS', empId: 'e_lopez', recordedAt: iso(15, 21) });
  rows = await all(id);
  const [ferrero1, bosio1, lopez1] = rows;
  report('A 15:21 LOPEZ releva a FERRERO', r1.relieved?.shiftId === id('ferrero') && ferrero1.relievedBy === 'e_lopez' && ferrero1.isCompleted === true
    && ferrero1.completionReason === 'RELEVO_PRESENTE' && ferrero1.realEndTime?.toMillis?.() === ar(15, 21).toMillis() && ferrero1.isRetention !== true,
    `relieved=${r1.relieved?.shiftId} by=${ferrero1.relievedBy} end=${ferrero1.realEndTime?.toDate?.()?.toISOString?.()} reason=${ferrero1.completionReason}`);
  report('A BOSIO sigue retenido sin tocar', bosio1.isCompleted !== true && bosio1.isRetention === true && !bosio1.relievedBy && !bosio1.realEndTime,
    `bosio ret=${bosio1.isRetention} by=${bosio1.relievedBy || '-'} end=${bosio1.realEndTime ? 'sí' : 'no'}`);
  report('A LOPEZ vinculado a FERRERO', lopez1.relievedOutgoingShiftId === id('ferrero'), `relievedOutgoingShiftId=${lopez1.relievedOutgoingShiftId}`);

  // Tarjeta de BOSIO después de la fichada de LOPEZ: espera a BRIZUELA, nunca «LOPEZ ya fichó».
  const wb1 = waitFor(rows, 'bosio', ar(15, 22).toMillis());
  report('A tarjeta BOSIO: espera a BRIZUELA, sin «cierre en curso» de LOPEZ', wb1?.reliever?.id === id('brizuela') && !wb1.waitLabel.includes('ya fichó') && wb1.waitLabel.includes('BRIZUELA'),
    wb1?.waitLabel);

  // Misma foto pero antes de que el servidor escriba (los dos M presentes, LOPEZ presente sin vínculo):
  // la tarjeta de FERRERO dice «LOPEZ ya fichó · cierre en curso»; la de BOSIO no.
  const foto = rows.map((r) => (r.id === id('ferrero')
    ? { ...r, status: 'PRESENT', isPresent: true, isCompleted: false, realEndTime: null, relievedBy: null, completionReason: null, isRetention: true }
    : r.id === id('lopez') ? { ...r, relievedOutgoingShiftId: null } : r));
  const wfFoto = waitFor(foto, 'ferrero', ar(15, 21).toMillis());
  const wbFoto = waitFor(foto, 'bosio', ar(15, 21).toMillis());
  report('A «ya fichó · cierre en curso» solo en FERRERO', wfFoto?.reliever?.id === id('lopez') && wfFoto.waitLabel.includes('ya fichó · cierre en curso')
    && wbFoto?.reliever?.id === id('brizuela') && !wbFoto.waitLabel.includes('ya fichó'),
    `ferrero: ${wfFoto?.waitLabel} | bosio: ${wbFoto?.waitLabel}`);

  // 15:25 ficha BRIZUELA → releva a BOSIO.
  const r2 = await registrarPresencia(db, { shiftId: id('brizuela'), source: 'PORTAL_GPS', empId: 'e_brizuela', recordedAt: iso(15, 25) });
  rows = await all(id);
  const [, bosio2] = rows;
  report('A 15:25 BRIZUELA releva a BOSIO', r2.relieved?.shiftId === id('bosio') && bosio2.relievedBy === 'e_brizuela' && bosio2.isCompleted === true
    && bosio2.realEndTime?.toMillis?.() === ar(15, 25).toMillis() && bosio2.isRetention !== true,
    `relieved=${r2.relieved?.shiftId} by=${bosio2.relievedBy} end=${bosio2.realEndTime?.toDate?.()?.toISOString?.()}`);

  await runAutoCompletarTurnosPass(db, ctx, ar(15, 30));
  rows = await all(id);
  report('A 15:30 cron no reabre ni cambia nada', rows[0].relievedBy === 'e_lopez' && rows[1].relievedBy === 'e_brizuela' && rows[2].isPresent === true && rows[3].isPresent === true,
    `ferrero←${rows[0].relievedBy} bosio←${rows[1].relievedBy}`);
}

/** Caso B: la tarjeta tenía FERRERO↔LOPEZ y BOSIO↔BRIZUELA; ficha primero BRIZUELA → igual releva a FERRERO. */
async function casoB() {
  const id = await seed('fb');
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 15));
  // Forzar el emparejamiento que mostraban las tarjetas en prod.
  await db.collection('turnos').doc(id('ferrero')).update({ retentionAbsenceShiftId: id('lopez') });
  await db.collection('turnos').doc(id('bosio')).update({ retentionAbsenceShiftId: id('brizuela') });
  let rows = await all(id);
  const wf0 = waitFor(rows, 'ferrero', ar(15, 20).toMillis());
  const wb0 = waitFor(rows, 'bosio', ar(15, 20).toMillis());
  report('B tarjetas 15:20: FERRERO↔LOPEZ, BOSIO↔BRIZUELA (vínculo)', wf0?.reliever?.id === id('lopez') && wb0?.reliever?.id === id('brizuela'), `${wf0?.waitLabel} | ${wb0?.waitLabel}`);

  // Ficha BRIZUELA primero: tarjeta se actualiza (FERRERO ← BRIZUELA) y el servidor releva a FERRERO.
  const fotoB = rows.map((r) => (r.id === id('brizuela') ? { ...r, isPresent: true, status: 'PRESENT', checkInAt: ar(15, 21), realStartTime: ar(15, 21) } : r));
  const wfB = waitFor(fotoB, 'ferrero', ar(15, 21).toMillis());
  const wbB = waitFor(fotoB, 'bosio', ar(15, 21).toMillis());
  report('B tarjeta dinámica: FERRERO ← BRIZUELA ya fichó; BOSIO espera a LOPEZ', wfB?.reliever?.id === id('brizuela') && wfB.waitLabel.includes('ya fichó') && wbB?.reliever?.id === id('lopez') && !wbB.waitLabel.includes('ya fichó'),
    `ferrero: ${wfB?.waitLabel} | bosio: ${wbB?.waitLabel}`);

  const r1 = await registrarPresencia(db, { shiftId: id('brizuela'), source: 'PORTAL_GPS', empId: 'e_brizuela', recordedAt: iso(15, 21) });
  rows = await all(id);
  report('B 15:21 BRIZUELA releva a FERRERO (más tiempo en el puesto)', r1.relieved?.shiftId === id('ferrero') && rows[0].relievedBy === 'e_brizuela' && rows[0].isCompleted === true && rows[1].isCompleted !== true && !rows[1].relievedBy,
    `relieved=${r1.relieved?.shiftId} ferrero←${rows[0].relievedBy} bosio←${rows[1].relievedBy || '-'}`);
  const wb1 = waitFor(rows, 'bosio', ar(15, 22).toMillis());
  report('B tarjeta BOSIO espera a LOPEZ', wb1?.reliever?.id === id('lopez') && !wb1.waitLabel.includes('ya fichó'), wb1?.waitLabel);

  const r2 = await registrarPresencia(db, { shiftId: id('lopez'), source: 'PORTAL_GPS', empId: 'e_lopez', recordedAt: iso(15, 25) });
  rows = await all(id);
  report('B 15:25 LOPEZ releva a BOSIO', r2.relieved?.shiftId === id('bosio') && rows[1].relievedBy === 'e_lopez' && rows[1].isCompleted === true && rows[1].realEndTime?.toMillis?.() === ar(15, 25).toMillis(),
    `relieved=${r2.relieved?.shiftId} bosio←${rows[1].relievedBy}`);
}

/** Caso C: el cron encuentra a LOPEZ ya presente (fichó antes de que corriera registrarPresencia el relevo) y cierra a FERRERO, no a BOSIO. */
async function casoC() {
  const id = await seed('fc');
  await runAutoCompletarTurnosPass(db, ctx, ar(15, 15));
  await db.collection('turnos').doc(id('lopez')).update({ status: 'PRESENT', isPresent: true, checkInAt: ar(15, 21), realStartTime: ar(15, 21) });
  const res = await runAutoCompletarTurnosPass(db, ctx, ar(15, 22));
  const rows = await all(id);
  const ferreroAct = res.actions.find((a) => a.shiftId === id('ferrero'));
  const bosioAct = res.actions.find((a) => a.shiftId === id('bosio'));
  report('C cron con LOPEZ presente: cierra FERRERO (RELEVO_PRESENTE) y BOSIO sigue retenido esperando a BRIZUELA',
    ferreroAct?.kind === 'CLOSE' && ferreroAct?.reason === 'RELEVO_PRESENTE' && rows[0].isCompleted === true
    && (!bosioAct || bosioAct.kind !== 'CLOSE') && rows[1].isCompleted !== true && String(rows[1].retentionReason || '').includes('BRIZUELA'),
    `ferrero=${ferreroAct?.kind}/${ferreroAct?.reason} bosio=${bosioAct?.kind || 'WAIT'}/${rows[1].retentionReason}`);
}

/** Paridad ops-core / functions de la función de emparejamiento. */
function paridad() {
  const t = (h, m) => Date.parse(iso(h, m));
  const mk = (id, code, start, end, extra = {}) => ({ id, code, positionName: 'Puesto 2', startMs: start, endMs: end, ...extra });
  const ferrero = mk('ferrero', 'M', t(11, 30), t(15, 15), { employeeId: 'e_ferrero', checkInAt: t(11, 38) });
  const bosio = mk('bosio', 'M', t(11, 30), t(15, 15), { employeeId: 'e_bosio', checkInAt: t(12, 5) });
  const lopez = mk('lopez', 'T', t(15, 15), t(23, 15), { employeeId: 'e_lopez' });
  const brizuela = mk('brizuela', 'T', t(15, 15), t(23, 15), { employeeId: 'e_brizuela' });
  for (const [name, lib] of [['ops-core', core], ['functions', fnSeries]]) {
    const outs = lib.sortOutgoingsFifo([bosio, ferrero]).map((r) => r.id).join(',');
    const ins = lib.sortIncomingsFifo([brizuela, { ...lopez, checkInAt: t(15, 21) }]).map((r) => r.id).join(',');
    const pares = lib.pairReliefs([bosio, ferrero], [brizuela, { ...lopez, checkInAt: t(15, 21) }]).map((p) => `${p.outgoing.id}←${p.incoming?.id}`).join(' ');
    const out1 = lib.outgoingFor({ ...lopez, checkInAt: t(15, 21) }, [bosio, ferrero])?.id;
    const out2 = lib.outgoingFor(brizuela, [{ ...bosio }, { ...ferrero, relievedBy: 'e_lopez' }])?.id;
    const rel = lib.relieverFor(bosio, [brizuela, { ...lopez, checkInAt: t(15, 21) }], { peers: [ferrero] })?.id;
    const tie = lib.pairReliefs([{ ...ferrero, retentionAbsenceShiftId: 'lopez' }, bosio], [brizuela, lopez]).map((p) => `${p.outgoing.id}←${p.incoming?.id}`).join(' ');
    const forced = lib.pairReliefs([ferrero, { ...bosio, relievedBy: 'e_lopez' }], [brizuela, { ...lopez, checkInAt: t(15, 21) }]).map((p) => `${p.outgoing.id}←${p.incoming?.id}:${p.kind}`).join(' ');
    const app = mk('ferrero', 'M', t(11, 30), t(15, 15), { employeeId: 'e_ferrero', checkInAt: t(11, 38) + 6000, realStartTime: t(11, 38) + 6000 });
    const operador = mk('bosio', 'M', t(11, 30), t(15, 15), { employeeId: 'e_bosio', realStartTime: t(12, 5) + 36000 });
    const sinCheckIn = lib.sortOutgoingsFifo([operador, app]).map((r) => r.id).join(',');
    const cerca = mk('z_cerca', 'M', t(11, 30), t(15, 15), { employeeId: 'e_cerca', checkInAt: t(11, 38) });
    const lejos = mk('a_lejos', 'M', t(11, 30), t(15, 15), { employeeId: 'e_lejos', checkInAt: t(11, 38) });
    const roster = [
      mk('duty_cerca', 'M', t(11, 30) + 86400000, t(11, 30) + 86400000 + 8 * 3600000, { employeeId: 'e_cerca' }),
      mk('franco', 'F', t(11, 30) + 20 * 3600000, t(11, 30) + 28 * 3600000, { employeeId: 'e_lejos', isFranco: true }),
      mk('duty_lejos', 'M', t(11, 30) + 4 * 86400000, t(11, 30) + 4 * 86400000 + 8 * 3600000, { employeeId: 'e_lejos' }),
    ];
    const porDescanso = lib.sortOutgoingsFifo([lejos, cerca], { roster }).map((r) => r.id).join(',');
    const relevaCerca = lib.outgoingFor({ ...lopez, checkInAt: t(15, 21) }, [lejos, cerca], { roster })?.id;
    report(`${name} FIFO`, outs === 'ferrero,bosio' && ins === 'lopez,brizuela' && pares === 'ferrero←lopez bosio←brizuela' && out1 === 'ferrero' && out2 === 'bosio' && rel === 'brizuela'
      && tie === 'ferrero←lopez bosio←brizuela' && forced === 'ferrero←brizuela:SERIES bosio←lopez:FORCED'
      && sinCheckIn === 'ferrero,bosio' && porDescanso === 'z_cerca,a_lejos' && relevaCerca === 'z_cerca',
      `outs=${outs} ins=${ins} pares=${pares} outgoingFor(lopez)=${out1} outgoingFor(brizuela|ferrero relevado)=${out2} relieverFor(bosio)=${rel} empate→vínculo=${tie} forzado=${forced} sinCheckIn=${sinCheckIn} descanso=${porDescanso} releva=${relevaCerca}`);
  }
}

/** Prod: BOSIO marcado por el operador (realStartTime, sin checkInAt); FERRERO por la app. */
async function casoD() {
  const id = await seed('fd');
  await db.collection('turnos').doc(id('ferrero')).update({ checkInAt: arSec(11, 38, 6), realStartTime: arSec(11, 38, 6) });
  await db.collection('turnos').doc(id('bosio')).update({
    checkInAt: admin.firestore.FieldValue.delete(),
    realStartTime: arSec(12, 5, 36),
  });
  const r = await registrarPresencia(db, { shiftId: id('lopez'), source: 'PORTAL_GPS', empId: 'e_lopez', recordedAt: iso(15, 21) });
  const ferrero = (await db.collection('turnos').doc(id('ferrero')).get()).data();
  const bosio = (await db.collection('turnos').doc(id('bosio')).get()).data();
  report('D sin checkInAt no es el más antiguo: LOPEZ releva a FERRERO',
    r.relieved?.shiftId === id('ferrero') && ferrero?.relievedBy === 'e_lopez' && bosio?.isCompleted !== true && !bosio?.checkInAt,
    `relieved=${r.relieved?.shiftId} bosioCompleted=${bosio?.isCompleted} bosioCheckInAt=${bosio?.checkInAt ? 'sí' : 'no'}`);
}

/** Mismo segundo de ingreso: se releva primero al que tiene el próximo turno más cerca. */
async function casoE() {
  const prefix = 'fe';
  const oid = `${prefix}_peaje`;
  await db.collection('servicios_sla').doc(`${prefix}_sla`).set({
    objectiveId: oid, clientId: `${prefix}_cli`, status: 'active', startDate: '2026-01-01', endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 2', quantity: 2, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', startTime: '11:30', endTime: '15:15', hours: 8, quantity: 2 },
        { code: 'T', startTime: '15:15', endTime: '23:15', hours: 8, quantity: 2 },
      ],
    }],
  });
  const base = { empresaId: `${prefix}_emp`, objectiveId: oid, positionName: 'Puesto 2' };
  const mismo = arSec(11, 38, 0);
  const dia = (offset, h, min) => Timestamp.fromDate(new Date(`2026-10-${String(1 + offset).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));
  await db.batch()
    .set(db.collection('turnos').doc(`${prefix}_z_cerca`), { ...base, ...present({ employeeId: 'e_cerca', employeeName: 'CERCA', code: 'M', startTime: ar(11, 30), endTime: END, checkInAt: mismo, realStartTime: mismo }) })
    .set(db.collection('turnos').doc(`${prefix}_a_lejos`), { ...base, ...present({ employeeId: 'e_lejos', employeeName: 'LEJOS', code: 'M', startTime: ar(11, 30), endTime: END, checkInAt: mismo, realStartTime: mismo }) })
    .set(db.collection('turnos').doc(`${prefix}_lopez`), { ...base, employeeId: 'e_lopez', employeeName: 'LOPEZ, HECTOR', code: 'T', status: 'PENDING', startTime: END, endTime: ar(23, 15) })
    .set(db.collection('turnos').doc(`${prefix}_duty_cerca`), { ...base, employeeId: 'e_cerca', employeeName: 'CERCA', code: 'M', status: 'PENDING', startTime: dia(1, 7, 0), endTime: dia(1, 15, 0) })
    .set(db.collection('turnos').doc(`${prefix}_franco`), { ...base, employeeId: 'e_lejos', employeeName: 'LEJOS', code: 'F', isFranco: true, status: 'PENDING', startTime: dia(1, 0, 0), endTime: dia(1, 23, 59) })
    .set(db.collection('turnos').doc(`${prefix}_duty_lejos`), { ...base, employeeId: 'e_lejos', employeeName: 'LEJOS', code: 'M', status: 'PENDING', startTime: dia(5, 7, 0), endTime: dia(5, 15, 0) })
    .commit();
  const r = await registrarPresencia(db, { shiftId: `${prefix}_lopez`, source: 'PORTAL_GPS', empId: 'e_lopez', recordedAt: iso(15, 21) });
  const cerca = (await db.collection('turnos').doc(`${prefix}_z_cerca`).get()).data();
  const lejos = (await db.collection('turnos').doc(`${prefix}_a_lejos`).get()).data();
  report('E mismo segundo: releva al que tiene el próximo turno más cerca',
    r.relieved?.shiftId === `${prefix}_z_cerca` && cerca?.relievedBy === 'e_lopez' && lejos?.isCompleted !== true,
    `relieved=${r.relieved?.shiftId} lejosCompleted=${lejos?.isCompleted}`);
}

/** El ingreso manual del operador deja checkInAt con la hora real de la marca. */
async function casoOperador() {
  const id = 'op_marca';
  await db.collection('turnos').doc(id).set({
    empresaId: 'op_emp', objectiveId: 'op_obj', positionName: 'Puesto 9',
    employeeId: 'e_op', employeeName: 'OP', code: 'M', status: 'PENDING',
    startTime: ar(11, 30), endTime: END,
  });
  await registrarPresencia(db, { shiftId: id, source: 'OPERATIONS', empId: 'e_op', recordedAt: iso(12, 5) });
  const d = (await db.collection('turnos').doc(id).get()).data();
  const mark = Date.parse(iso(12, 5));
  report('operador escribe checkInAt', d?.checkInAt?.toMillis?.() === mark && d?.isPresent === true,
    `checkInAt=${d?.checkInAt?.toDate?.()?.toISOString?.()} present=${d?.isPresent}`);
}

async function main() {
  paridad();
  await casoA();
  await casoB();
  await casoC();
  await casoD();
  await casoE();
  await casoOperador();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exitCode = 1;
  console.log(`relevo FIFO ${results.length - failed.length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

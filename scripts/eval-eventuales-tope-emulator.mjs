/**
 * Tope de horas: el servidor no asigna si el turno pasa el tope, la excepción con motivo sí,
 * el aviso sale desde el 80% y dos aceptaciones a la vez no se pisan.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-tope "node scripts/eval-eventuales-tope-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-tope';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { asignarEventualPlanificacion, listarCandidatosEventuales } = requireFn('./lib/eventuales/planificacionEventuales.js');
const { gestionarEventual } = requireFn('./lib/eventuales/gestionarEventual.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}
const ctx = { auth: { uid: 'uid-tope', token: { role: 'SuperAdmin', email: 'tope@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };

const EMP = 'th_emp';
const CUIL = '20111111119';
const MENSAJE = 'Supera el tope mensual (48/50 h, este turno 8 h)';

function bolsa(extra = {}) {
  return {
    cuil: CUIL, nombre: 'Perez, Ana', disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    mail: 'ana@bacarsa.com.ar', telefono: '3510000000', domicilio: 'Cordoba',
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
    status: 'ACTIVE', ...extra,
  };
}
function turno(fecha, horas = 8) {
  return {
    empresaId: EMP, bolsaCuil: CUIL, esEventual: true, code: 'EV', scheduleDate: fecha, hours: horas,
    horaInicio: '08:00', status: 'ACTIVE', draft: false,
  };
}
function pedido(fecha, horaInicio) {
  return {
    empresaId: EMP, cuil: CUIL, modo: 'TURNOS', objectiveName: 'Peaje', positionName: 'Puesto 1',
    turnos: [{ fecha, horaInicio, horaFin: '16:00', horas: 8, code: 'EV' }],
  };
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Tope SA', status: 'ACTIVE' });
  await db.collection('eventuales_bolsa').doc(CUIL).set(bolsa());
  for (let dia = 1; dia <= 6; dia += 1) {
    await db.collection('turnos').add(turno(`2026-10-${String(dia).padStart(2, '0')}`));
  }

  const bloqueo = await intentar(() => asignarEventualPlanificacion.run(pedido('2026-10-20', '08:00'), ctx));
  report('no asigna si 48 h + 8 h pasan el tope de 50', !bloqueo.ok && String(bloqueo.message).includes(MENSAJE), bloqueo.message || '');

  const horas = await intentar(() => gestionarEventual.run({ accion: 'horasMes', empresaId: EMP, cuils: [CUIL], fecha: '2026-10-02' }, ctx));
  const fila = horas.value?.filas?.find((f) => f.cuil === CUIL);
  report('horas usadas del mes calendario', horas.ok && fila?.usadas === 48 && fila?.tope === 50 && fila?.texto === '48/50 h este mes', JSON.stringify(fila || horas.message));

  await db.collection('turnos').add(turno('2026-09-20'));
  const soloSep = await intentar(() => gestionarEventual.run({ accion: 'horasMes', empresaId: EMP, cuils: [CUIL], fecha: '2026-10-02' }, ctx));
  report('el 20/09 no entra en el mes calendario de octubre', soloSep.ok && soloSep.value?.filas?.[0]?.usadas === 48, String(soloSep.value?.filas?.[0]?.usadas));
  await db.collection('turnos').add(turno('2026-10-28'));
  const cal = await intentar(() => gestionarEventual.run({ accion: 'horasMes', empresaId: EMP, cuils: [CUIL], fecha: '2026-10-02' }, ctx));
  const filaCal = cal.value?.filas?.find((f) => f.cuil === CUIL);
  report('el 28/10 sí entra en octubre calendario', cal.ok && filaCal?.usadas === 56, String(filaCal?.usadas));
  await db.collection('turnos').add(turno('2026-09-27'));
  await db.collection('turnos').add(turno('2026-09-30'));

  const ciclo = await intentar(() => gestionarEventual.run({ accion: 'guardarTopeEmpresa', empresaId: EMP, horas: 50, periodo: 'CICLO_26_25' }, ctx));
  const auditSnap = await db.collection('audit_logs').where('action', '==', 'EVENTUAL_TOPE_EMPRESA').get();
  const audit = auditSnap.docs.filter((d) => d.data().empresaId === EMP);
  report('guardar el ciclo 26→25 deja audit_logs', ciclo.ok && audit.length > 0, ciclo.message || '');
  const enCiclo = await intentar(() => gestionarEventual.run({ accion: 'horasMes', empresaId: EMP, cuils: [CUIL], fecha: '2026-10-02' }, ctx));
  const filaCiclo = enCiclo.value?.filas?.find((f) => f.cuil === CUIL);
  report('el ciclo 26→25 suma 27/09 y 30/09 y deja afuera el 20/09 y el 28/10', enCiclo.ok && filaCiclo?.usadas === 64, String(filaCiclo?.usadas));

  await gestionarEventual.run({ accion: 'guardarTopeEmpresa', empresaId: EMP, horas: 50, periodo: 'CALENDARIO' }, ctx);
  const lista = await intentar(() => listarCandidatosEventuales.run({
    empresaId: EMP,
    jornadas: [{ fecha: '2026-10-21', horaInicio: '08:00', horaFin: '16:00', horas: 8 }],
  }, ctx));
  const cand = (lista.value?.candidatos || []).find((c) => c.cuil === CUIL);
  report('la lista marca el tope y no lo ofrece', lista.ok && cand?.elegible === false && cand?.motivo === 'Supera el tope mensual (56/50 h, este turno 8 h)', cand?.motivo || lista.message || '');

  await db.collection('turnos').where('bolsaCuil', '==', CUIL).get().then(async (snap) => {
    const batch = db.batch();
    snap.docs.slice(0, 1).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  });
  const aviso = await intentar(() => listarCandidatosEventuales.run({
    empresaId: EMP,
    jornadas: [{ fecha: '2026-11-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 }],
  }, ctx));
  const candAviso = (aviso.value?.candidatos || []).find((c) => c.cuil === CUIL);
  report('noviembre vacío: 0/50, elegible y sin ámbar', aviso.ok && candAviso?.elegible === true && candAviso?.horasMes?.texto === '0/50 h este mes' && candAviso?.horasMes?.aviso === false, candAviso?.horasMes?.texto || aviso.message || '');

  for (let dia = 1; dia <= 5; dia += 1) await db.collection('turnos').add(turno(`2026-11-${String(dia).padStart(2, '0')}`));
  const al80 = await intentar(() => listarCandidatosEventuales.run({
    empresaId: EMP,
    jornadas: [{ fecha: '2026-11-20', horaInicio: '08:00', horaFin: '16:00', horas: 8 }],
  }, ctx));
  const cand80 = (al80.value?.candidatos || []).find((c) => c.cuil === CUIL);
  report('desde el 80% sigue elegible y avisa', al80.ok && cand80?.elegible === true && cand80?.horasMes?.aviso === true && cand80?.horasMes?.texto === '40/50 h este mes', `${cand80?.horasMes?.texto} aviso=${cand80?.horasMes?.aviso} ${cand80?.motivo || ''}`);

  const sinMotivo = await intentar(() => gestionarEventual.run({ accion: 'guardarTopeExcepcion', empresaId: EMP, cuil: CUIL, horas: 80, motivo: ' ' }, ctx));
  report('excepción sin motivo se rechaza', !sinMotivo.ok, sinMotivo.message || '');
  const conMotivo = await intentar(() => gestionarEventual.run({ accion: 'guardarTopeExcepcion', empresaId: EMP, cuil: CUIL, horas: 80, motivo: 'Cobertura de feriado' }, ctx));
  const auditExSnap = await db.collection('audit_logs').where('action', '==', 'EVENTUAL_TOPE_EXCEPCION').get();
  const auditEx = auditExSnap.docs.filter((d) => d.data().bolsaCuil === CUIL);
  report('excepción con motivo queda auditada', conMotivo.ok && auditEx.length > 0, conMotivo.message || '');
  const conEx = await intentar(() => asignarEventualPlanificacion.run(pedido('2026-11-21', '08:00'), ctx));
  report('con excepción de 80 h la asignación entra', conEx.ok === true, conEx.message || '');

  await db.collection('eventuales_bolsa').doc(CUIL).update({ topeHorasExcepcion: admin.firestore.FieldValue.delete(), topeHorasReservas: admin.firestore.FieldValue.delete() });
  for (let dia = 1; dia <= 5; dia += 1) await db.collection('turnos').add(turno(`2026-12-${String(dia).padStart(2, '0')}`));
  const carrera = await Promise.all([
    intentar(() => asignarEventualPlanificacion.run(pedido('2026-12-20', '08:00'), ctx)),
    intentar(() => asignarEventualPlanificacion.run(pedido('2026-12-22', '08:00'), ctx)),
  ]);
  const ganaron = carrera.filter((r) => r.ok).length;
  const perdio = carrera.find((r) => !r.ok);
  report('dos aceptaciones a la vez: una entra y la otra supera el tope', ganaron === 1 && String(perdio?.message || '').includes('Supera el tope mensual'), carrera.map((r) => r.ok ? 'ok' : r.message).join(' | '));

  const fallas = results.filter((r) => !r.ok);
  if (fallas.length) {
    console.error(`${fallas.length} falla(s)`);
    process.exit(1);
  }
  console.log(`${results.length} casos OK`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

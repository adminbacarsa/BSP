/**
 * Consulta sin uid: la ve el eventual por bolsaCuil y el SuperAdmin en vista previa.
 * Responder en preview asigna y queda auditado como preview.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-consulta-preview "node scripts/eval-consulta-preview-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-consulta-preview';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { crearConsultaDisponibilidad, responderConsultaDisponibilidad } = requireFn('./lib/eventuales/consultaDisponibilidad.js');
const { completarUidInvitacionesAbiertas } = requireFn('./lib/eventuales/consultaDisponibilidad.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'cp_emp';
const PLANNER = { auth: { uid: 'uid-plan', token: { role: 'SuperAdmin', email: 'plan@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const SA = { auth: { uid: 'uid-sa-preview', token: { role: 'SuperAdmin', email: 'mauro@bacarsa.com.ar' } }, rawRequest: { ip: '10.0.0.2', headers: {} } };
const ABALLAY = { cuil: '20334141463', nombre: 'ABALLAY ROLON', uid: 'uid-aballay-temp' };

function bolsa(p) {
  return {
    cuil: p.cuil, nombre: p.nombre, uid: p.uid, disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    mail: `${p.cuil}@bacarsa.com.ar`, telefono: '3510000000', domicilio: 'Cordoba',
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } },
    status: 'ACTIVE',
  };
}
function pedido(cuil, fecha) {
  return {
    empresaId: EMP, cuils: [cuil], lugares: 1, venceMinutos: 120,
    objectiveName: 'Plaza de la Musica', positionName: 'general', clientName: 'Pruebas',
    jornadas: [{ fecha, horaInicio: '12:00', horaFin: '20:00', horas: 8, code: 'EV' }],
  };
}
async function crearYQuitarUid(cuil, fecha) {
  const creada = await crearConsultaDisponibilidad.run(pedido(cuil, fecha), PLANNER);
  const id = `${creada.consultaId}_${cuil}`;
  await db.collection('consultas_disponibilidad_invitaciones').doc(id).update({ uid: null });
  return { consultaId: creada.consultaId, invitacionId: id };
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'Pruebas SA', status: 'ACTIVE' });
  await db.collection('eventuales_bolsa').doc(ABALLAY.cuil).set(bolsa(ABALLAY));
  await db.collection('device_tokens').doc(`tok-${ABALLAY.uid}`).set({
    uid: ABALLAY.uid, token: 'token-aballay-preview-0123456789', pushEstado: 'activo',
  });

  const preview = await crearYQuitarUid(ABALLAY.cuil, '2026-11-20');
  const invPrev = (await db.collection('consultas_disponibilidad_invitaciones').doc(preview.invitacionId).get()).data();
  const porCuil = await db.collection('consultas_disponibilidad_invitaciones').where('bolsaCuil', '==', ABALLAY.cuil).get();
  report(
    'invitación sin uid se encuentra por bolsaCuil',
    !invPrev?.uid && porCuil.docs.some((d) => d.id === preview.invitacionId && d.data().estado === 'PENDIENTE'),
    `uid=${invPrev?.uid} estado=${invPrev?.estado} n=${porCuil.size}`,
  );

  const ajeno = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: preview.invitacionId, respuesta: 'SI',
  }, SA));
  report('SuperAdmin sin la persona no responde', !ajeno.ok && ajeno.code === 'permission-denied', ajeno.code || ajeno.message);

  const operador = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: preview.invitacionId, respuesta: 'SI', asBolsaCuil: ABALLAY.cuil,
  }, { auth: { uid: 'uid-op', token: { role: 'OPERADOR' } }, rawRequest: { ip: '10.0.0.3', headers: {} } }));
  report('otro rol no responde aunque mande el CUIL', !operador.ok && operador.code === 'permission-denied', operador.code || operador.message);

  const siPreview = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: preview.invitacionId, respuesta: 'SI', asBolsaCuil: ABALLAY.cuil,
  }, SA));
  const turno = (await db.collection('turnos').where('bolsaCuil', '==', ABALLAY.cuil).get()).docs
    .find((d) => d.data().scheduleDate === '2026-11-20');
  const audit = await db.collection('audit_logs').where('empresaId', '==', EMP).get();
  const auditPreview = audit.docs.map((d) => d.data()).find((d) => d.action === 'CONSULTA_DISPONIBILIDAD_ASIGNADO' && d.preview === true);
  report(
    'vista previa asigna y audita al SuperAdmin',
    siPreview.ok && siPreview.value?.codigo === 'ASIGNADO' && !!turno
      && auditPreview?.actorUid === 'uid-sa-preview' && auditPreview?.modo === 'preview'
      && String(auditPreview?.details || '').startsWith('Vista previa'),
    `${siPreview.value?.codigo || siPreview.message} turno=${!!turno} actor=${auditPreview?.actorUid} modo=${auditPreview?.modo}`,
  );

  const porClaim = await crearYQuitarUid(ABALLAY.cuil, '2026-11-21');
  const siClaim = await intentar(() => responderConsultaDisponibilidad.run({
    invitacionId: porClaim.invitacionId, respuesta: 'NO',
  }, { auth: { uid: 'uid-ev-nuevo', token: { role: 'EVENTUAL', bolsaCuil: ABALLAY.cuil } }, rawRequest: { ip: '10.0.0.4', headers: {} } }));
  const invClaim = (await db.collection('consultas_disponibilidad_invitaciones').doc(porClaim.invitacionId).get()).data();
  report(
    'el eventual responde por claim bolsaCuil aunque la invitación no tenga uid',
    siClaim.ok && siClaim.value?.codigo === 'NO' && invClaim?.estado === 'NO' && !invClaim?.preview,
    `${siClaim.value?.codigo || siClaim.message} estado=${invClaim?.estado}`,
  );

  const relleno = await crearYQuitarUid(ABALLAY.cuil, '2026-11-22');
  const n = await completarUidInvitacionesAbiertas({ uid: 'uid-acceso-nuevo', bolsaCuil: ABALLAY.cuil });
  const invRelleno = (await db.collection('consultas_disponibilidad_invitaciones').doc(relleno.invitacionId).get()).data();
  const invYaRespondida = (await db.collection('consultas_disponibilidad_invitaciones').doc(porClaim.invitacionId).get()).data();
  report(
    'crear el acceso completa el uid solo de las abiertas',
    n >= 1 && invRelleno?.uid === 'uid-acceso-nuevo' && !invYaRespondida?.uid,
    `n=${n} abierta=${invRelleno?.uid} cerrada=${invYaRespondida?.uid || 'vacio'}`,
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`FALLARON ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`OK ${results.length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

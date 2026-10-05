/**
 * Parámetros ARCA: solo EVENTUALES update (o SuperAdmin) los escribe, el formato se valida
 * y el TXT de carga masiva sale con los códigos guardados. CCT vacío = no enviable.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-arca "node scripts/eval-eventuales-arca-parametros-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { lineasCargaMasiva } from '../apps/web2/src/lib/eventuales/arcaTxt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-arca';
admin.initializeApp({ projectId });
const db = admin.firestore();
const { gestionarEventual } = requireFn('./lib/eventuales/gestionarEventual.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'ap_emp';
const ctxAdmin = { auth: { uid: 'uid-arca-admin', token: { role: 'SuperAdmin' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ctxRead = { auth: { uid: 'uid-arca-read', token: { role: 'OPERADOR' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ctxUpdate = { auth: { uid: 'uid-arca-upd', token: { role: 'OPERADOR' } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const VALORES = {
  cctCodigo: '42205',
  categoria: '033104',
  modalidadContrato: '012',
  obraSocialDefault: '122807',
  situacionRevistaDesistimiento: '30',
  situacionRevistaBaja: '31',
  puesto: '9999',
  sucursal: '00012',
  actividad: '801000',
  nocturnoPct: '13.33',
};

async function main() {
  await db.collection('empresas').doc(EMP).set({ name: 'ARCA SA', status: 'ACTIVE' });
  await db.collection('roles').doc('ROL_ARCA_READ').set({ permissions: { EVENTUALES: ['read'] } });
  await db.collection('roles').doc('ROL_ARCA_UPD').set({ permissions: { EVENTUALES: ['read', 'update'] } });
  await db.collection('system_users').doc('uid-arca-read').set({ role: 'ROL_ARCA_READ', empresaId: EMP });
  await db.collection('system_users').doc('uid-arca-upd').set({ role: 'ROL_ARCA_UPD', empresaId: EMP });

  const sinSesion = await intentar(() => gestionarEventual.run({ accion: 'leerArcaEventuales', empresaId: EMP }, { rawRequest: {} }));
  report('sin sesión no lee', !sinSesion.ok && sinSesion.code === 'unauthenticated', sinSesion.code || sinSesion.message);

  const lee = await intentar(() => gestionarEventual.run({ accion: 'leerArcaEventuales', empresaId: EMP }, ctxRead));
  report('con lectura ve los códigos y el CCT pendiente', lee.ok && lee.value?.valores?.modalidadContrato === '012' && lee.value?.avisoCct === 'Pendiente: consultar al contador' && lee.value?.enviable === false, lee.message || lee.value?.avisoCct || '');

  const niega = await intentar(() => gestionarEventual.run({ accion: 'guardarArcaEventuales', empresaId: EMP, valores: VALORES }, ctxRead));
  report('sin permiso update no guarda', !niega.ok && niega.code === 'permission-denied', niega.code || niega.message);

  const malo = await intentar(() => gestionarEventual.run({ accion: 'guardarArcaEventuales', empresaId: EMP, valores: { ...VALORES, categoria: '104' } }, ctxUpdate));
  report('la categoría que no tiene 6 dígitos se rechaza', !malo.ok && malo.code === 'invalid-argument' && String(malo.message).includes('6 dígitos'), malo.message || malo.code);

  const pct = await intentar(() => gestionarEventual.run({ accion: 'guardarArcaEventuales', empresaId: EMP, valores: { ...VALORES, nocturnoPct: '150' } }, ctxAdmin));
  report('nocturnidad fuera de 0 a 100 se rechaza', !pct.ok && String(pct.message).includes('nocturnidad'), pct.message || '');

  const guarda = await intentar(() => gestionarEventual.run({ accion: 'guardarArcaEventuales', empresaId: EMP, valores: VALORES }, ctxUpdate));
  const doc = (await db.collection('empresas').doc(EMP).get()).data()?.arcaEventuales || {};
  report('update guarda los códigos y el % de nocturnidad', guarda.ok && doc.categoria === '033104' && doc.sucursal === '00012' && doc.situacionRevistaBaja === '31' && doc.nocturnoPct === 13.33 && doc.categoriaProfesional === '033104', JSON.stringify({ categoria: doc.categoria, nocturnoPct: doc.nocturnoPct }));

  const txt = lineasCargaMasiva({
    contrato: { fechaAlta: '2026-10-02', fechaBaja: '2026-10-03' },
    cuil: '20999999991',
    bruto: 1000,
    obraSocial: doc.obraSocialDefault,
    empresa: { id: EMP, arcaEventuales: doc },
  });
  const alta = txt.lineas[0];
  report('el TXT usa los valores editados', txt.enviable && alta.slice(16, 19) === '012' && alta.slice(39, 45) === '122807' && alta.slice(73, 78) === '00012' && alta.slice(84, 88) === '9999' && alta.slice(100, 106) === '033104' && txt.lineas[1].slice(45, 47) === '31', alta.slice(73, 106));

  const vacio = await intentar(() => gestionarEventual.run({ accion: 'guardarArcaEventuales', empresaId: EMP, valores: { ...VALORES, cctCodigo: '' } }, ctxAdmin));
  report('CCT vacío se guarda y el TXT queda no enviable', vacio.ok && vacio.value?.enviable === false && vacio.value?.avisoCct === 'Pendiente: consultar al contador', vacio.message || String(vacio.value?.enviable));

  const audits = await db.collection('audit_logs').where('empresaId', '==', EMP).get();
  const nAudit = audits.docs.filter((d) => d.data().action === 'EVENTUAL_ARCA_PARAMETROS').length;
  report('queda audit_logs de los dos guardados', nAudit >= 2, String(nAudit));

  const fallas = results.filter((r) => !r.ok);
  console.log(fallas.length ? `${fallas.length} FALLAS` : `${results.length} casos OK`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

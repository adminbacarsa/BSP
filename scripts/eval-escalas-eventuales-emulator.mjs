/**
 * Escala salarial del anexo del eventual (Eventuales → Escala salarial). Emulador aislado (no el lab :8080).
 *   npx firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-escalas "node scripts/eval-escalas-eventuales-emulator.mjs"
 *
 * Casos: permiso (sin EVENTUALES update → permission-denied); importar la Disp. 120/2026 como PROPUESTA + novedad;
 * editar una celda con motivo (historial, confianza ALTA); editar sin motivo rechaza; aprobar → version 1,
 * escalas_salariales ACTIVE por tramo × categoría + novedad aprobada; brutoDelAnexo con la escala del mes y
 * con respaldo (fecha sin escala → usa la de hoy y avisa); corrección sobre la aprobada → nueva PROPUESTA
 * derivada; aprobar la corrección → v2, la v1 queda REEMPLAZADA y las filas viejas también; rechazar.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-escalas' });
const db = admin.firestore();

const { gestionarEscalaCct } = requireFn('./lib/escalas/gestionarEscalaCct.js');
const { brutoDelAnexo } = requireFn('./lib/eventuales/marcoAnexoCall.js');

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'escalas-cct', 'fixtures', 'disp-120-2026.extraido.json'), 'utf8'));

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail ?? ''}`);
}

const ctx = (uid, role) => ({
  auth: { uid, token: role ? { role, email: `${uid}@test.local` } : { email: `${uid}@test.local` } },
  rawRequest: { ip: '127.0.0.1', headers: {} },
});
const call = (data, uid = 'sa', role = 'SuperAdmin') => gestionarEscalaCct.run(data, ctx(uid, role));
async function falla(p) {
  try { await p; return null; } catch (e) { return e; }
}

async function main() {
  await db.collection('empresas').doc('emp_a').set({ nombre: 'Empresa A', status: 'ACTIVE' });
  await db.collection('roles').doc('rol_rrhh').set({ permissions: { EVENTUALES: ['read', 'update'] } });
  await db.collection('roles').doc('rol_lectura').set({ permissions: { EVENTUALES: ['read'] } });
  await db.collection('system_users').doc('rrhh').set({ role: 'rol_rrhh', email: 'rrhh@test.local', empresaId: 'emp_a' });
  await db.collection('system_users').doc('lector').set({ role: 'rol_lectura', email: 'lector@test.local', empresaId: 'emp_a' });

  // 1. permiso
  const e1 = await falla(call({ accion: 'importar', propuesta: fixture }, 'lector', null));
  report('sin EVENTUALES update → permission-denied', e1?.code === 'permission-denied', e1?.code);

  // 2. importar como PROPUESTA
  const imp = await call({ accion: 'importar', propuesta: fixture, empresaId: 'emp_a' }, 'rrhh', null);
  const docId = imp?.docId || imp?.id;
  const prop = (await db.collection('escalas_cct').doc(docId).get()).data();
  report('importar → escalas_cct PROPUESTA', prop?.estado === 'PROPUESTA' && prop?.tramos?.length === 6, `${docId} ${prop?.estado}`);
  const novProp = await db.collection('novedades').where('type', '==', 'ESCALA_CCT_PROPUESTA').get();
  report('importar → novedad ESCALA_CCT_PROPUESTA', novProp.size >= 1, `novedades=${novProp.size}`);

  // 3. editar con motivo
  const vig = (e, mes) => e.tramos.find((t) => t.mes === mes).categorias.find((c) => c.codigo === 'VIGILADOR');
  const antes = vig(prop, '2026-01').viatico.valor;
  await call({ accion: 'editar', docId, motivo: 'Corrige viático según planilla SUVICO', cambios: [{ mes: '2026-01', codigo: 'VIGILADOR', campo: 'viatico', valor: antes + 100 }] }, 'rrhh', null);
  const ed = (await db.collection('escalas_cct').doc(docId).get()).data();
  const celda = vig(ed, '2026-01').viatico;
  report('editar celda → valor, confianza ALTA, historial', celda.valor === antes + 100 && celda.confianza === 'ALTA' && ed.historial?.length === 1 && ed.historial[0].cambios[0].antes === antes, `viatico ${antes}→${celda.valor}`);
  const e3 = await falla(call({ accion: 'editar', docId, motivo: '', cambios: [{ mes: '2026-01', codigo: 'VIGILADOR', campo: 'basico', valor: 1 }] }, 'rrhh', null));
  report('editar sin motivo → rechaza', !!e3, e3?.message);

  // 4. aprobar
  await call({ accion: 'aprobar', docId, motivo: 'Primera carga' }, 'rrhh', null);
  const ap = (await db.collection('escalas_cct').doc(docId).get()).data();
  const filas = await db.collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
  const filaEne = filas.docs.find((d) => d.id === 'CCT_422_05_VIGILADOR_2026-01-01')?.data();
  report('aprobar → APROBADA v1 + escalas_salariales ACTIVE', ap.estado === 'APROBADA' && ap.version === 1 && filas.size === 6 * ap.tramos[0].categorias.length && !!filaEne, `filas=${filas.size}`);
  report('fila ene VIGILADOR enlaza la escala CCT', filaEne?.escalaCctId === docId && filaEne?.escalaVersion === 1 && filaEne?.basicoMensual === vig(ap, '2026-01').basico.valor, `basico=${filaEne?.basicoMensual}`);
  const novAp = await db.collection('novedades').where('type', '==', 'ESCALA_CCT_APROBADA').get();
  report('aprobar → novedad ESCALA_CCT_APROBADA', novAp.size >= 1, `novedades=${novAp.size}`);

  // 5. bruto del anexo
  const b = await brutoDelAnexo({ categoria: 'VIGILADOR_GENERAL' }, [{ fecha: '2026-01-14', horaInicio: '08:00', horaFin: '16:00' }], '2026-01-10');
  report('brutoDelAnexo ene 2026 con la escala del mes', b.bruto > 0 && !b.escalaRespaldo && b.escalaTexto.includes('Disp. 120/2026') && b.escalas.includes('CCT_422_05_VIGILADOR_2026-01-01'), `${b.brutoTexto} · ${b.escalaTexto}`);
  const r = await brutoDelAnexo({ categoria: 'VIGILADOR_GENERAL' }, [{ fecha: '2026-09-14', horaInicio: '08:00', horaFin: '16:00' }], '2026-06-10');
  report('brutoDelAnexo fecha sin escala → respaldo con aviso', r.bruto > 0 && r.escalaRespaldo && /hoy|respaldo|no hay escala/i.test(r.escalaTexto), r.escalaTexto);

  // 6. corrección sobre la aprobada → nueva PROPUESTA derivada
  const corr = await call({ accion: 'editar', docId, motivo: 'Ajuste básico marzo', cambios: [{ mes: '2026-03', codigo: 'VIGILADOR', campo: 'basico', valor: vig(ap, '2026-03').basico.valor + 1000 }] }, 'rrhh', null);
  const nuevoId = corr?.docId || corr?.id;
  const der = (await db.collection('escalas_cct').doc(nuevoId).get()).data();
  const sigue = (await db.collection('escalas_cct').doc(docId).get()).data();
  report('corrección sobre APROBADA → nueva PROPUESTA derivada', nuevoId !== docId && der?.estado === 'PROPUESTA' && der?.derivadaDe === docId && sigue.estado === 'APROBADA', nuevoId);

  // 7. aprobar la corrección → v2, la anterior REEMPLAZADA
  await call({ accion: 'aprobar', docId: nuevoId, motivo: 'Corrección' }, 'sa', 'SuperAdmin');
  const v2 = (await db.collection('escalas_cct').doc(nuevoId).get()).data();
  const v1 = (await db.collection('escalas_cct').doc(docId).get()).data();
  const activas = await db.collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
  const marzo = activas.docs.find((d) => d.id === 'CCT_422_05_VIGILADOR_2026-03-01')?.data();
  report('aprobar corrección → v2, v1 REEMPLAZADA, diff registrado', v2.estado === 'APROBADA' && v2.version === 2 && v2.reemplazaA === docId && v1.estado === 'REEMPLAZADA' && v1.reemplazadaPor === nuevoId && (v2.diffContraAnterior?.length || 0) >= 1, `diffs=${v2.diffContraAnterior?.length}`);
  report('escalas_salariales: una sola ACTIVE por categoría/mes y toma el v2', activas.size === filas.size && marzo?.escalaCctId === nuevoId && marzo?.basicoMensual === vig(v2, '2026-03').basico.valor, `activas=${activas.size}`);

  // 8. rechazar
  const otra = { ...fixture, documentoHash: 'f'.repeat(64), vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-12-31' };
  const imp2 = await call({ accion: 'importar', propuesta: otra, empresaId: 'emp_a' }, 'rrhh', null);
  const id2 = imp2?.docId || imp2?.id;
  await call({ accion: 'rechazar', docId: id2, motivo: 'Duplicada' }, 'rrhh', null);
  const rech = (await db.collection('escalas_cct').doc(id2).get()).data();
  report('rechazar → RECHAZADA con motivo', rech?.estado === 'RECHAZADA' && rech?.rechazoMotivo === 'Duplicada', id2);

  const fallas = results.filter((x) => !x.ok);
  console.log(`\n${results.length - fallas.length}/${results.length} OK`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

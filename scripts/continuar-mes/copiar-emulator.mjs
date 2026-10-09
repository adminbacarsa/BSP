/**
 * Copia SOLO LECTURA de prod (comtroldata) un objetivo de Bacar SA a un emulador propio para probar
 * «Continuar desde el mes anterior». El mes destino queda vacío salvo sus licencias (lo que ya estaría
 * cargado al planificar): así se ve qué propone la continuación.
 *
 *   node scripts/continuar-mes/copiar-emulator.mjs --obj 9CbYIDmsUGnabENKvXZt --mes 2026-10 [--fs 127.0.0.1:8291 --auth 127.0.0.1:9291]
 *
 * No escribe en producción: las escrituras van a la app «emu», que apunta al emulador.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../apps/functions/package.json', import.meta.url)));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const args = process.argv.slice(2);
const arg = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OBJ = arg('--obj', '9CbYIDmsUGnabENKvXZt');
const MES = arg('--mes', '2026-10');
const EMPRESA = arg('--empresa', 'bacarsa');
const EMU_FS = arg('--fs', '127.0.0.1:8291');
const EMU_AUTH = arg('--auth', '127.0.0.1:9291');
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('No arranques este script con el emulador en el entorno: primero lee prod.');
}
if (/^(127\.0\.0\.1|localhost):(8080|9099)$/.test(EMU_FS) || /:(9099)$/.test(EMU_AUTH)) throw new Error('Esos puertos son del lab de Mauro.');

const prod = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod'));
const AR = 'America/Argentina/Buenos_Aires';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: AR }).format(d);
const LICENCIAS = new Set(['V', 'L', 'E', 'A', 'PG', 'ART', 'AA', 'SUS', 'SGS']);
const [Y, M] = MES.split('-').map(Number);
const desde = new Date(Date.UTC(Y, M - 4, 1, 3));
const hasta = new Date(Date.UTC(Y, M, 1, 3));
const primerDia = `${MES}-01`;

const clients = await prod.collection('clients').where('empresaId', '==', EMPRESA).get();
const clientDoc = clients.docs.find((d) => (d.data().objetivos || []).some((o) => o.id === OBJ));
if (!clientDoc) throw new Error('No encontré el objetivo');
const objetivo = clientDoc.data().objetivos.find((o) => o.id === OBJ);
const turnos = await prod.collection('turnos').where('objectiveId', '==', OBJ).where('startTime', '>=', desde).where('startTime', '<', hasta).get();
const delMesAMano = [];
const copiar = [];
for (const d of turnos.docs) {
  const t = d.data();
  const dia = ymd(t.startTime.toDate());
  if (dia < primerDia) copiar.push(d);
  else {
    delMesAMano.push({ id: d.id, ...t, dateStr: dia });
    if (LICENCIAS.has(String(t.code || '').toUpperCase())) copiar.push(d);
  }
}
const empIds = new Set(turnos.docs.map((d) => String(d.data().employeeId || '')).filter((x) => x && x !== 'VACANTE'));
const prefer = await prod.collection('empleados').where('preferredObjectiveId', '==', OBJ).get();
prefer.docs.forEach((d) => empIds.add(d.id));
const empleados = [];
const ids = [...empIds];
for (let i = 0; i < ids.length; i += 10) {
  const s = await prod.collection('empleados').where(FieldPath.documentId(), 'in', ids.slice(i, i + 10)).get();
  empleados.push(...s.docs);
}
const ausencias = [];
for (let i = 0; i < ids.length; i += 10) {
  const s = await prod.collection('ausencias').where('employeeId', 'in', ids.slice(i, i + 10)).get();
  ausencias.push(...s.docs);
}
const slas = await prod.collection('servicios_sla').where('objectiveId', '==', OBJ).get();
const estados = await prod.collection('planificacion_estados').where('objectiveId', '==', OBJ).get();
const empresa = await prod.collection('empresas').doc(EMPRESA).get();
console.log({ objetivo: objetivo.name, turnosCopiados: copiar.length, delMesAMano: delMesAMano.length, empleados: empleados.length, conPreferido: empleados.filter((e) => e.data().preferredObjectiveId === OBJ).length, ausencias: ausencias.length, slas: slas.size });

process.env.FIRESTORE_EMULATOR_HOST = EMU_FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = EMU_AUTH;
const emuApp = initializeApp({ projectId: 'comtroldata' }, 'emu');
const emu = getFirestore(emuApp);
emu.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(emuApp);

const email = 'admin@bacarsa.com.ar';
try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
const user = await auth.createUser({ email, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
await emu.collection('system_users').doc(user.uid).set({ email, role: 'SUPERADMIN', empresaId: EMPRESA, nombre: 'Admin', allEmpresas: true });
await emu.collection('empresas').doc(EMPRESA).set(empresa.exists ? empresa.data() : { name: EMPRESA });
await emu.collection('clients').doc(clientDoc.id).set(clientDoc.data());
const batchWrite = async (col, docs, transform = (x) => x) => {
  for (let i = 0; i < docs.length; i += 400) {
    const b = emu.batch();
    for (const d of docs.slice(i, i + 400)) b.set(emu.collection(col).doc(d.id), transform(d.data(), d));
    await b.commit();
  }
};
// Sin el lote viejo del objetivo (corridas anteriores) en el emulador.
const viejos = await emu.collection('turnos').where('objectiveId', '==', OBJ).get();
for (let i = 0; i < viejos.docs.length; i += 400) {
  const b = emu.batch();
  viejos.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
  await b.commit();
}
await batchWrite('servicios_sla', slas.docs);
await batchWrite('empleados', empleados, (e) => ({ ...e, ...(e.preferredObjectiveId ? {} : { preferredObjectiveId: OBJ }) }));
await batchWrite('turnos', copiar);
await batchWrite('ausencias', ausencias);
await batchWrite('planificacion_estados', estados.docs.filter((d) => !d.id.endsWith(`_${Y}_${M}`)));

// La grilla toma el campo `id` del documento si existe (clientes legacy): el deep link usa ese.
const manifest = { objectiveId: OBJ, clientId: String(clientDoc.data().id || clientDoc.id), empresaId: EMPRESA, mes: MES, objetivo: objetivo.name };
writeFileSync(fileURLToPath(new URL('./.manifest.json', import.meta.url)), JSON.stringify(manifest, null, 2));
writeFileSync(fileURLToPath(new URL('./.mes-a-mano.json', import.meta.url)), JSON.stringify(delMesAMano.map((t) => ({ employeeId: t.employeeId, dateStr: t.dateStr, code: t.code, positionName: t.positionName }))));
console.log(manifest, '→ emulador', EMU_FS);
process.exit(0);

/**
 * Certificado: propuesta y aprobación, automático, eventual sin licencia, sin Drive queda en Storage.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-cert-ia "node scripts/eval-certificado-ia-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-cert-ia';
admin.initializeApp({ projectId });
const db = admin.firestore();
const { procesarCertificadoSubido, aplicarDecisionCertificado } = requireFn('./lib/rrhh/certificadoLegajo.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

function driveFalso() {
  let n = 0;
  const creados = [];
  return {
    creados,
    files: {
      async list() {
        return { data: { files: [] } };
      },
      async create(req) {
        n += 1;
        const id = `drv${n}`;
        creados.push({
          id,
          name: req.requestBody?.name,
          parents: req.requestBody?.parents || [],
          folder: req.requestBody?.mimeType === 'application/vnd.google-apps.folder',
        });
        return { data: { id, webViewLink: `https://drive.google.com/file/d/${id}/view` } };
      },
    },
  };
}

const lecturaOk = {
  fechaEmision: '2026-10-07',
  medico: 'Gomez',
  matricula: '1234',
  reposoDesde: '2026-10-07',
  reposoHasta: '2026-10-08',
  tipo: 'enfermedad',
  firmaVisible: true,
  selloVisible: true,
  legible: true,
  nombre: 'CARDO ANALIA',
  dni: '30111222',
  diagnostico: 'no guardar',
  confianza: { tipo: 0.95, reposoDesde: 0.95, reposoHasta: 0.95, medico: 0.9, matricula: 0.9 },
};

const bytes = Buffer.from('%PDF-1.4 certificado');

async function seedAusencia(id, extra = {}) {
  await db.collection('ausencias').doc(id).set({
    employeeId: 'legajo1',
    employeeName: 'CARDO Analia',
    empresaId: 'empCert',
    type: 'Ausencia con aviso',
    status: 'Avisada',
    revisionEstado: 'POR_REVISAR',
    startDate: '2026-10-07',
    endDate: '2026-10-08',
    source: 'EMPLEADO',
    certificateUrl: 'https://example.test/cert',
    certificateStoragePath: 'absences/uid/cert.pdf',
    certificateName: 'cert.pdf',
    ...extra,
  });
}

async function run() {
  await db.collection('empresas').doc('empCert').set({
    name: 'Pruebas',
    legajosDriveFolderId: 'raiz-legajos',
    certificadoIaModo: 'PROPUESTA',
  });
  await db.collection('empleados').doc('legajo1').set({
    lastName: 'CARDO',
    firstName: 'Analia',
    dni: '30111222',
    cuil: '27301112224',
    fileNumber: '1402',
    empresaId: 'empCert',
  });

  const drive1 = driveFalso();
  await seedAusencia('aus-propuesta');
  const propuesta = await procesarCertificadoSubido(db, 'aus-propuesta', (await db.collection('ausencias').doc('aus-propuesta').get()).data(), {
    bytes,
    mime: 'application/pdf',
    drive: drive1,
    lector: async () => lecturaOk,
  });
  const aus1 = (await db.collection('ausencias').doc('aus-propuesta').get()).data();
  report('propuesta no justifica sola', propuesta.decision === 'PROPUESTA' && aus1.status === 'En verificación' && aus1.certificadoIa?.texto?.includes('Justificar como E'), aus1.certificadoIa?.texto || '');
  report('sin diagnóstico guardado', aus1.certificadoIa?.diagnostico == null, '');
  report('archivo en la carpeta del legajo', !!aus1.certificateDriveFileId && drive1.creados.some((c) => String(c.name).startsWith('CARDO Analia')), drive1.creados.map((c) => c.name).join(' | '));
  const legajo = (await db.collection('empleados').doc('legajo1').get()).data();
  report('driveFolderId en el legajo', !!legajo.driveFolderId, legajo.driveFolderId || '');

  await aplicarDecisionCertificado(db, { ausenciaId: 'aus-propuesta', decision: 'aprobar', actor: 'RRHH' });
  const aprobada = (await db.collection('ausencias').doc('aus-propuesta').get()).data();
  const metricas = (await db.collection('empresas').doc('empCert').get()).data()?.certificadoIaMetricas || {};
  report('aprobar justifica como E', aprobada.status === 'Justificada' && aprobada.absenceType === 'E' && aprobada.justificadaPor === 'IA', aprobada.status);
  report('métrica de aprobadas', Number(metricas.aprobadas) === 1, String(metricas.aprobadas));

  await db.collection('empresas').doc('empCert').set({ certificadoIaModo: 'AUTOMATICO' }, { merge: true });
  await seedAusencia('aus-auto', { employeeId: 'legajo1' });
  const drive2 = driveFalso();
  const auto = await procesarCertificadoSubido(db, 'aus-auto', (await db.collection('ausencias').doc('aus-auto').get()).data(), {
    bytes,
    mime: 'application/pdf',
    drive: drive2,
    lector: async () => lecturaOk,
  });
  const ausAuto = (await db.collection('ausencias').doc('aus-auto').get()).data();
  report('automático justifica si coincide', auto.decision === 'JUSTIFICAR' && ausAuto.status === 'Justificada' && ausAuto.justificadaPor === 'IA', ausAuto.status);

  await db.collection('empresas').doc('empSin').set({ name: 'Sin carpeta', certificadoIaModo: 'PROPUESTA' });
  await db.collection('empleados').doc('legajoSin').set({ lastName: 'SOSA', firstName: 'Luis', empresaId: 'empSin' });
  await seedAusencia('aus-pendiente', { empresaId: 'empSin', employeeId: 'legajoSin', employeeName: 'SOSA Luis' });
  const pendiente = await procesarCertificadoSubido(db, 'aus-pendiente', (await db.collection('ausencias').doc('aus-pendiente').get()).data(), {
    bytes,
    lector: async () => lecturaOk,
    drive: null,
  });
  const ausPend = (await db.collection('ausencias').doc('aus-pendiente').get()).data();
  report('sin Drive queda en Storage', pendiente.drivePendiente === true && ausPend.certificateDrivePendiente === true && ausPend.certificateStoragePath === 'absences/uid/cert.pdf' && !ausPend.certificateDriveFileId, '');

  await db.collection('eventuales_bolsa').doc('27301112225').set({ nombre: 'PEREZ JUAN', driveFolderId: 'carpeta-bolsa', driveFolderName: 'PEREZ JUAN' });
  await db.collection('empleados').doc('legajoEv').set({ lastName: 'PEREZ', firstName: 'Juan', empresaId: 'empCert', bolsaCuil: '27301112225' });
  await seedAusencia('aus-ev', {
    employeeId: 'legajoEv',
    employeeName: 'PEREZ Juan',
    bolsaCuil: '27301112225',
    esEventual: true,
  });
  const driveEv = driveFalso();
  const ev = await procesarCertificadoSubido(db, 'aus-ev', (await db.collection('ausencias').doc('aus-ev').get()).data(), {
    bytes,
    mime: 'application/pdf',
    drive: driveEv,
    lector: async () => lecturaOk,
  });
  const ausEv = (await db.collection('ausencias').doc('aus-ev').get()).data();
  const legEv = (await db.collection('empleados').doc('legajoEv').get()).data();
  const certs = driveEv.creados.find((c) => c.name === 'Certificados');
  report('eventual no se justifica', ev.decision === 'RECIBIDO' && ausEv.status !== 'Justificada' && ausEv.certificadoIa?.texto === 'Certificado recibido', ausEv.status);
  report('misma carpeta de la bolsa', certs?.parents?.[0] === 'carpeta-bolsa' && legEv.driveFolderId === 'carpeta-bolsa', legEv.driveFolderId || '');

  const fallas = results.filter((r) => !r.ok).length;
  console.log(`\n${fallas === 0 ? 'ok' : 'falla'} certificado IA: ${results.length - fallas}/${results.length}`);
  process.exit(fallas ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Avisos del portal que quedaron «Pendiente» (y los que el formulario de RRHH
 * mostró como Vacaciones). SOLO LECTURA por defecto.
 *
 *   node scripts/fix-aviso-portal-pendiente.mjs --empresa pruebas_sa
 *   node scripts/fix-aviso-portal-pendiente.mjs --empresa pruebas_sa --apply --allow-prod
 *
 * Activa los de hoy en adelante (calendario Argentina). --apply escribe en prod.
 * Antes de --apply: npm run build en apps/functions. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { esAvisoParaActivar } from '../apps/web2/src/lib/rrhh/avisoPortal.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : '';

if (!empresaId) {
  console.error('Falta --empresa (ej. --empresa pruebas_sa)');
  process.exit(1);
}
if (apply && !allowProd) {
  console.error('Para escribir hace falta --apply --allow-prod');
  process.exit(1);
}

function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

async function main() {
  const hoy = hoyAR();
  const snap = await db.collection('ausencias')
    .where('empresaId', '==', empresaId)
    .where('source', '==', 'EMPLEADO')
    .where('status', '==', 'Pendiente')
    .limit(500)
    .get();

  const filas = snap.docs.filter((d) => {
    const data = d.data();
    const desde = String(data.startDate || '').slice(0, 10);
    return esAvisoParaActivar(data) && desde >= hoy;
  });

  console.log(`${apply ? 'APLICAR' : 'dryRun'} ${empresaId} desde ${hoy}: ${filas.length} aviso(s)`);
  for (const d of filas) {
    const data = d.data();
    console.log(`- ${d.id} ${data.employeeName || ''} tipo=${data.type} caso=${data.absenceCase || ''} turno=${data.shiftId || ''} ${data.startDate}`);
  }
  if (!apply) {
    console.log('Sin escrituras. Para activarlos: --apply --allow-prod');
    return;
  }

  const { aplicarAvisoPortal } = requireFn('./lib/attendance/avisoPortal.js');
  for (const d of filas) {
    const res = await aplicarAvisoPortal(db, d.id, d.data(), { corregirVacaciones: true });
    console.log(`  escrito ${d.id} turnos=${res.turnos}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

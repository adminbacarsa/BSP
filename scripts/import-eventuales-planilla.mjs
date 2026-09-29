/**
 * Import de la planilla SP Eventuales → eventuales_bolsa + legajos.
 * Por defecto solo dry-run. --apply no escribe: queda para un OK explícito de Mauro.
 *
 *   node scripts/import-eventuales-planilla.mjs --file "C:\Users\Mauro\Downloads\SP Eventuales.xlsx"
 *
 * El detalle (con datos personales) va a scripts/out/eventuales-import-dryrun.json (gitignored).
 * La consola imprime solo cantidades.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COTEJO_EMPRESA_IDS, GRUPO_EVENTUALES_ID, IMPORT_CREATED_BY } from '../apps/web2/src/lib/eventuales/grupo.mjs';
import { normalizeCuil } from '../apps/web2/src/lib/eventuales/cuil.mjs';
import { buildBolsaDoc, planImportRow, repetidosEnPlanilla } from '../apps/web2/src/lib/eventuales/planilla.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let file = '';
  let apply = false;
  let allowProd = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file' && argv[i + 1]) file = argv[++i];
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--allow-prod') allowProd = true;
  }
  return { file, apply, allowProd };
}

function loadXlsx() {
  const candidates = [
    'xlsx',
    path.join(ROOT, 'apps/web2/node_modules/xlsx'),
    path.join(ROOT, 'node_modules/xlsx'),
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      /* siguiente */
    }
  }
  throw new Error('No está instalado el paquete xlsx (apps/web2).');
}

function readRows(file) {
  const XLSX = loadXlsx();
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headerAt = matrix.findIndex((row) => String(row?.[0] || '').trim().toUpperCase() === 'NOMBRE');
  if (headerAt < 0) throw new Error('La planilla no tiene columna NOMBRE.');
  const headers = matrix[headerAt].map((h) => String(h || '').trim());
  const idx = (re) => headers.findIndex((h) => re.test(h));
  const col = {
    nombre: idx(/^NOMBRE$/i),
    legajo: idx(/LEGAJO/i),
    cuil: idx(/CUIL/i),
    ingreso: idx(/INGRESO/i),
    estado: idx(/ESTADO/i),
    efectivizacion: idx(/EFECTIV/i),
    baja: idx(/BAJA/i),
  };
  return matrix.slice(headerAt + 1).filter((row) => String(row[col.nombre] || '').trim() !== '').map((row, i) => ({
    fila: headerAt + 2 + i,
    nombre: String(row[col.nombre] || '').trim(),
    legajo: String(row[col.legajo] ?? '').trim(),
    cuilRaw: row[col.cuil],
    ingreso: isoDate(row[col.ingreso]),
    estadoRaw: String(row[col.estado] || '').trim(),
    fechaEfectivizacionPlanilla: isoDate(row[col.efectivizacion]),
    bajaUltima: isoDate(row[col.baja]),
  }));
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value ?? '').trim();
  if (!s || s === '-') return '';
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!mdy) return s;
  const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
  return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
}

async function loadLegajosPorCuil() {
  let appMod;
  let firestoreMod;
  try {
    appMod = require('firebase-admin/app');
    firestoreMod = require('firebase-admin/firestore');
  } catch {
    return { ok: false, motivo: 'firebase-admin no está instalado', empleados: [] };
  }
  const { initializeApp, getApps, cert } = appMod;
  const { getFirestore } = firestoreMod;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!getApps().length) {
    if (emulator) {
      initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
    } else {
      const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS
        || path.join(ROOT, 'service-account.json');
      if (fs.existsSync(sa)) initializeApp({ credential: cert(sa), projectId: 'comtroldata' });
      else initializeApp({ projectId: 'comtroldata' });
    }
  }
  const db = getFirestore();
  const empleados = [];
  for (const empresaId of COTEJO_EMPRESA_IDS) {
    const snap = await db.collection('empleados').where('empresaId', '==', empresaId).get();
    snap.forEach((doc) => {
      const data = doc.data() || {};
      empleados.push({
        employeeId: doc.id,
        empresaId,
        cuil: normalizeCuil(data.cuil || data.CUIL),
        fileNumber: String(data.fileNumber || data.legajo || '').trim(),
        modalidad: data.modalidad || '',
        fechaEfectivizacion: data.fechaEfectivizacion || '',
        status: data.status || '',
      });
    });
  }
  return { ok: true, motivo: emulator ? `emulador ${emulator}` : 'lectura', empleados };
}

function matchesDe(empleados, cuil, legajo) {
  const leg = String(legajo || '').trim();
  return empleados.filter((e) => (cuil && e.cuil === cuil) || (leg && e.fileNumber === leg));
}

function emptyEmpresa() {
  return { plantaPermanente: 0, eventual: 0, noExiste: 0 };
}

function emptyCounts() {
  return {
    filas: 0,
    porEstado: { ACTIVO: 0, EFECTIVIZADO: 0, BAJA: 0, GOLONDRINA: 0, DESCONOCIDO: 0 },
    cuilInvalidos: 0,
    entranBolsa: 0,
    legajosSeCrearian: 0,
    duplicadosPlantaPermanente: 0,
    repetidosEnPlanilla: 0,
    yaEnPruebasSaNoSeSuben: 0,
    yaEventualNoSeDuplica: 0,
    efectivizadosConLegajo: 0,
    efectivizadosSinLegajo: 0,
    efectivizadosYaIndeterminadoConFecha: 0,
    porEmpresa: Object.fromEntries(COTEJO_EMPRESA_IDS.map((id) => [id, emptyEmpresa()])),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.apply && !args.allowProd) {
    console.error('--apply requiere --allow-prod. No se escribió nada.');
    process.exit(2);
  }
  if (!args.file) {
    console.error('Falta --file con la planilla .xlsx');
    process.exit(1);
  }
  const rows = readRows(args.file);
  const lookup = await loadLegajosPorCuil();
  const repetidos = repetidosEnPlanilla(rows);
  const counts = emptyCounts();
  counts.filas = rows.length;
  const detalle = [];
  const aEscribir = [];

  rows.forEach((row, i) => {
    const cuil = normalizeCuil(row.cuilRaw);
    const matches = lookup.ok ? matchesDe(lookup.empleados, cuil, row.legajo) : [];
    const plan = planImportRow({
      estadoRaw: row.estadoRaw,
      cuilRaw: row.cuilRaw,
      ingreso: row.ingreso,
      fechaBaja: row.bajaUltima,
      matches: lookup.ok ? matches : [],
      repetidoEnPlanilla: repetidos[i],
    });
    counts.porEstado[plan.estado] = (counts.porEstado[plan.estado] || 0) + 1;
    if (plan.bucket === 'CUIL_INVALIDO') counts.cuilInvalidos += 1;
    if (plan.repetidoEnPlanilla) counts.repetidosEnPlanilla += 1;
    if (lookup.ok && plan.duplicadoPlanta) counts.duplicadosPlantaPermanente += 1;
    if (plan.entraBolsa) {
      counts.entranBolsa += 1;
      aEscribir.push(buildBolsaDoc(row, plan));
    }
    if (lookup.ok) {
      for (const empresaId of COTEJO_EMPRESA_IDS) {
        const clase = plan.porEmpresa[empresaId];
        if (clase === 'PLANTA_PERMANENTE') counts.porEmpresa[empresaId].plantaPermanente += 1;
        else if (clase === 'EVENTUAL') counts.porEmpresa[empresaId].eventual += 1;
        else counts.porEmpresa[empresaId].noExiste += 1;
      }
    }
    if (plan.estado === 'EFECTIVIZADO') {
      if (plan.legajoExiste) counts.efectivizadosConLegajo += 1;
      else counts.efectivizadosSinLegajo += 1;
      if (plan.indeterminadoConFecha) counts.efectivizadosYaIndeterminadoConFecha += 1;
    }
    detalle.push({
      fila: row.fila,
      nombre: row.nombre,
      legajoPlanilla: row.legajo,
      cuil: plan.cuil,
      ingreso: row.ingreso,
      fechaBaja: row.bajaUltima,
      estado: plan.estado,
      bucket: plan.bucket,
      entraBolsa: plan.entraBolsa,
      disponibilidad: plan.disponibilidad,
      arcaHistorial: plan.arcaHistorial,
      docId: plan.cuil,
      duplicadoPlanta: Boolean(plan.duplicadoPlanta),
      repetidoEnPlanilla: Boolean(plan.repetidoEnPlanilla),
      riesgoEncadenamiento: Boolean(plan.riesgoEncadenamiento),
      porEmpresa: plan.porEmpresa,
      matches: matches.map((m) => ({ employeeId: m.employeeId, empresaId: m.empresaId, modalidad: m.modalidad || null })),
      grupoId: GRUPO_EVENTUALES_ID,
    });
  });

  const outDir = path.join(ROOT, 'scripts/out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'eventuales-import-dryrun.json');
  fs.writeFileSync(outFile, JSON.stringify({
    generadoAt: new Date().toISOString(),
    lookup: lookup.ok ? lookup.motivo : lookup.motivo,
    lookupOk: lookup.ok,
    counts,
    detalle,
  }, null, 2));

  if (args.apply) {
    if (!lookup.ok) {
      console.error('Sin cotejo de empleados no se escribe: no se puede excluir la planta permanente.');
      process.exit(2);
    }
    const escritos = await escribirBolsa(aEscribir);
    console.log(JSON.stringify({ apply: true, ...escritos, filas: counts.filas }));
    return;
  }

  console.log(JSON.stringify({
    dryRun: true,
    lookupOk: lookup.ok,
    filas: counts.filas,
    porEstado: counts.porEstado,
    cuilInvalidos: counts.cuilInvalidos,
    duplicadosPlantaPermanente: lookup.ok ? counts.duplicadosPlantaPermanente : null,
    repetidosEnPlanilla: counts.repetidosEnPlanilla,
    seEscribirian: counts.entranBolsa,
    porEmpresa: lookup.ok ? counts.porEmpresa : null,
  }));
}

async function escribirBolsa(docs) {
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const db = getFirestore();
  let nuevos = 0;
  let actualizados = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const slice = docs.slice(i, i + 400);
    const refs = slice.map((d) => db.collection('eventuales_bolsa').doc(d.cuil));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    snaps.forEach((snap, idx) => {
      const data = { ...slice[idx], updatedAt: FieldValue.serverTimestamp() };
      if (!snap.exists) {
        data.createdAt = FieldValue.serverTimestamp();
        data.legajos = [];
        nuevos += 1;
      } else {
        actualizados += 1;
      }
      batch.set(snap.ref, data, { merge: true });
    });
    batch.set(db.collection('audit_logs').doc(), {
      action: 'IMPORT_EVENTUALES_BOLSA',
      actorUid: 'SYSTEM',
      actorName: IMPORT_CREATED_BY,
      module: 'RRHH',
      empresaId: 'bacarsa',
      grupoId: GRUPO_EVENTUALES_ID,
      createdBy: IMPORT_CREATED_BY,
      details: `Import bolsa eventuales: ${slice.length} fichas. No crea ni modifica legajos.`,
      timestamp: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  }
  return { escritos: docs.length, nuevos, actualizados };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

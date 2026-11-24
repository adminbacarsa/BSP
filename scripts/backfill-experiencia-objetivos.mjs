/**
 * Completa `empleados.experienciaObjetivos` (pestaña Experiencia del legajo) con el historial de turnos:
 * en qué objetivos trabajó cada guardia, cuántos turnos (regulares, refuerzo, escuela, convocado), qué
 * puestos conoce y cuándo estuvo por última vez. De ahí salen «Conocido» / «En escuela» en Modo Rapido
 * (retenes por destino), en la cobertura del CC y en la planificación.
 *
 * Cuenta un turno si: ya empezó, no es borrador ni borrado, no es ausencia/baja (ABSENT, SUPERSEDED,
 * CANCELLED, sin cobertura…), tiene guardia y objetivo, y el código es de trabajo (no franco ni licencia).
 * RET sin cobertura es stand-by: no cuenta. Nunca baja un contador que ya existe en el legajo (usa el máximo).
 *
 * Sin --apply solo lista. Escribir en prod pide --apply --allow-prod.
 *
 *   node scripts/backfill-experiencia-objetivos.mjs --empresa pruebas_sa
 *   node scripts/backfill-experiencia-objetivos.mjs --empresa pruebas_sa --empleado CAMINOS
 *   node scripts/backfill-experiencia-objetivos.mjs --empresa pruebas_sa --apply            (emulador)
 *   node scripts/backfill-experiencia-objetivos.mjs --empresa bacarsa --apply --allow-prod  (prod, con OK)
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const leer = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const EMPRESA = String(leer('--empresa', 'pruebas_sa')).trim();
const MESES = Number(leer('--meses', '12')) || 12;
const FILTRO_EMPLEADO = String(leer('--empleado', '')).trim().toLowerCase();
const APPLY = args.includes('--apply');
const EMULADOR = !!process.env.FIRESTORE_EMULATOR_HOST;
if (APPLY && !EMULADOR && !args.includes('--allow-prod')) {
  console.log('Escribir en prod pide --apply --allow-prod.');
  process.exit(1);
}

/** Misma regla que `experienciaObjetivos.ts` (ESCUELA_TURNOS_PARA_CONOCIDO). */
const ESCUELA_TURNOS_PARA_CONOCIDO = 3;
const CODIGOS_SIN_TRABAJO = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'LT', 'SUS']);
const ESTADOS_NO_TRABAJADOS = new Set([
  'ABSENT', 'SUPERSEDED', 'CANCELLED', 'CANCELED', 'SIN_COBERTURA', 'UNCOVERED_REPORTED', 'REPORTED_TO_PLANNING', 'REJECTED',
]);
const ORIGENES_CONVOCADO = new Set(['OPERATIONS_COVERAGE', 'RET_COBERTURA', 'RETEN']);
const POSICIONES_IGNORADAS = new Set(['General', 'Retén', '']);

const up = (s) => String(s ?? '').trim().toUpperCase();

function aMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function nivelDe(entry, esTitular) {
  if (esTitular) return 'TITULAR';
  const esc = entry.turnosEscuela ?? 0;
  if (esc >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
  if (esc > 0) return 'ESCUELA';
  const total = (entry.turnosRegulares ?? 0) + (entry.turnosRefuerzo ?? 0) + (entry.turnosConvocado ?? 0);
  if (total >= ESCUELA_TURNOS_PARA_CONOCIDO) return 'CONOCIDO';
  return 'NINGUNO';
}

/** Clasifica un turno: null si no cuenta como trabajado; si cuenta, qué contador suma. */
function clasificar(t, ahoraMs) {
  if (t.draft === true || t.isDeleted === true || t.coverageSuperseded === true) return null;
  if (t.isAbsent === true) return null;
  if (ESTADOS_NO_TRABAJADOS.has(up(t.status))) return null;
  const empleadoId = String(t.employeeId ?? '').trim();
  const objetivoId = String(t.objectiveId ?? '').trim();
  if (!empleadoId || empleadoId === 'VACANTE' || !objetivoId) return null;
  const inicio = aMs(t.startTime);
  if (inicio == null || inicio >= ahoraMs) return null;
  const code = up(t.code);
  if (CODIGOS_SIN_TRABAJO.has(code)) return null;
  const role = up(t.deploymentRole);
  const origen = up(t.origin);
  let campo;
  if (code === 'ESC' || role === 'TRAINING') campo = 'turnosEscuela';
  else if (code === 'REF' || role === 'SURPLUS') campo = 'turnosRefuerzo';
  else if (ORIGENES_CONVOCADO.has(origen) || code === 'FT') campo = 'turnosConvocado';
  else if (code === 'RET') return null;
  else campo = 'turnosRegulares';
  return { empleadoId, objetivoId, inicio, campo, puesto: String(t.positionName ?? '').trim() };
}

if (EMULADOR) console.log(`Emulador: ${process.env.FIRESTORE_EMULATOR_HOST}`);
admin.initializeApp({ projectId: 'comtroldata' });
const db = admin.firestore();

const ahoraMs = Date.now();
const desde = new Date(ahoraMs - MESES * 30 * 864e5);

const empSnap = await db.collection('empleados').where('empresaId', '==', EMPRESA).get();
const empleados = new Map(empSnap.docs.map((d) => [d.id, d.data()]));
console.log(`Empresa ${EMPRESA}: ${empleados.size} legajos. Turnos desde ${desde.toISOString().slice(0, 10)}.`);

const turnosSnap = await db
  .collection('turnos')
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(desde))
  .where('startTime', '<', admin.firestore.Timestamp.fromDate(new Date(ahoraMs)))
  .select(
    'empresaId', 'employeeId', 'objectiveId', 'startTime', 'code', 'status', 'origin', 'draft', 'isDeleted',
    'coverageSuperseded', 'isAbsent', 'deploymentRole', 'positionName',
  )
  .get();

/** empleadoId → objetivoId → acumulado. */
const calculado = new Map();
let contados = 0;
let leidos = 0;
for (const doc of turnosSnap.docs) {
  const t = doc.data();
  if (String(t.empresaId ?? '').trim() && String(t.empresaId).trim() !== EMPRESA) continue;
  leidos += 1;
  const c = clasificar(t, ahoraMs);
  if (!c || !empleados.has(c.empleadoId)) continue;
  contados += 1;
  let porObj = calculado.get(c.empleadoId);
  if (!porObj) {
    porObj = new Map();
    calculado.set(c.empleadoId, porObj);
  }
  const acc = porObj.get(c.objetivoId) || { turnosEscuela: 0, turnosRegulares: 0, turnosRefuerzo: 0, turnosConvocado: 0, puestos: new Set(), ultimaMs: 0 };
  acc[c.campo] += 1;
  if (c.puesto && !POSICIONES_IGNORADAS.has(c.puesto)) acc.puestos.add(c.puesto);
  if (c.inicio > acc.ultimaMs) acc.ultimaMs = c.inicio;
  porObj.set(c.objetivoId, acc);
}
console.log(`Turnos leídos: ${leidos} · cuentan como trabajados: ${contados} · guardias con historial: ${calculado.size}`);

const CAMPOS = ['turnosEscuela', 'turnosRegulares', 'turnosRefuerzo', 'turnosConvocado'];
const cambios = [];
for (const [empleadoId, porObj] of calculado) {
  const data = empleados.get(empleadoId);
  const nombre = `${data.lastName ?? ''}, ${data.firstName ?? ''}`.trim();
  if (FILTRO_EMPLEADO && !nombre.toLowerCase().includes(FILTRO_EMPLEADO)) continue;
  const actual = data.experienciaObjetivos && typeof data.experienciaObjetivos === 'object' ? data.experienciaObjetivos : {};
  const siguiente = { ...actual };
  let toco = false;
  for (const [objetivoId, acc] of porObj) {
    const previa = actual[objetivoId] || {};
    const entry = { ...previa };
    for (const campo of CAMPOS) {
      const nuevo = Math.max(Number(previa[campo]) || 0, acc[campo]);
      if (nuevo !== (Number(previa[campo]) || 0)) toco = true;
      if (nuevo > 0 || previa[campo] !== undefined) entry[campo] = nuevo;
    }
    const puestos = new Set([...(previa.posicionesConocidas || []), ...acc.puestos]);
    if (puestos.size !== (previa.posicionesConocidas || []).length) toco = true;
    if (puestos.size > 0) entry.posicionesConocidas = [...puestos];
    const previaMs = aMs(previa.ultimaPresencia) ?? 0;
    if (acc.ultimaMs > previaMs) {
      entry.ultimaPresencia = admin.firestore.Timestamp.fromMillis(acc.ultimaMs);
      toco = true;
    }
    entry.nivel = nivelDe(entry, String(data.preferredObjectiveId ?? '') === objetivoId);
    if (previa.nivel !== entry.nivel) toco = true;
    siguiente[objetivoId] = entry;
  }
  if (toco) cambios.push({ empleadoId, nombre, antes: Object.keys(actual).length, despues: Object.keys(siguiente).length, siguiente });
}

const niveles = { TITULAR: 0, CONOCIDO: 0, ESCUELA: 0, NINGUNO: 0 };
for (const c of cambios) for (const e of Object.values(c.siguiente)) niveles[e.nivel] = (niveles[e.nivel] || 0) + 1;
console.log(`Legajos a actualizar: ${cambios.length}. Entradas por nivel tras el cambio:`, niveles);
for (const c of cambios.slice(0, FILTRO_EMPLEADO ? 10 : 8)) {
  console.log(`- ${c.nombre}: objetivos con experiencia ${c.antes} → ${c.despues}`);
  if (FILTRO_EMPLEADO) {
    for (const [objetivoId, e] of Object.entries(c.siguiente)) {
      console.log(
        `    ${objetivoId}: ${e.nivel} · reg ${e.turnosRegulares ?? 0} · ref ${e.turnosRefuerzo ?? 0} · esc ${e.turnosEscuela ?? 0} · conv ${e.turnosConvocado ?? 0} · puestos ${(e.posicionesConocidas || []).join('/') || '—'}`,
      );
    }
  }
}

if (!APPLY) {
  console.log('\nSolo lectura. Agregá --apply para escribir (en prod: --apply --allow-prod).');
  process.exit(0);
}

let batch = db.batch();
let ops = 0;
let escritos = 0;
for (const c of cambios) {
  batch.update(db.collection('empleados').doc(c.empleadoId), { experienciaObjetivos: c.siguiente });
  ops += 1;
  escritos += 1;
  if (ops >= 400) {
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }
}
if (ops > 0) await batch.commit();
console.log(`\nEscritos ${escritos} legajos.`);

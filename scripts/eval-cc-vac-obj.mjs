/**
 * Paridad de solapas del CC: LISTA = unión de turnos dentro de los objetivos de OBJ.
 * Caso prod 05/10: VENENCIA T3 16:00 ausente, VAC=1 en lista y vacío en OBJ.
 */
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  OPS_OBJECTIVE_PARITY_TABS,
  addShiftToOpsBucket,
  emptyOpsObjectiveBucket,
  opsTabShiftIds,
} = await import(pathToFileURL(join(root, 'packages/ops-core/src/opsObjectiveTab.ts')).href);

const require = createRequire(join(root, 'apps/web2/package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const now = new Date(2026, 9, 5, 13, 53, 0);
const start = (h, m) => new Date(2026, 9, 5, h, m, 0);
const end = (h, m) => new Date(2026, 9, 5, h, m, 0);

const shifts = [
  {
    id: 'venencia', objectiveId: 'peaje', employeeName: 'VENENCIA, Daiana Soledad',
    code: 'T3', isAbsent: true, isFuture: true, isUnassigned: false,
    shiftDateObj: start(16, 0), endDateObj: end(17, 0),
  },
  {
    id: 'bosio', objectiveId: 'peaje', employeeName: 'BOSIO',
    code: 'M', isPresent: true, isCompleted: false,
    shiftDateObj: start(11, 30), endDateObj: end(15, 15),
  },
  {
    id: 'farias', objectiveId: 'peaje', employeeName: 'FARIAS',
    code: 'M3', isPresent: true, isCompleted: false, isRetention: true,
    shiftDateObj: start(12, 30), endDateObj: end(16, 0),
  },
  {
    id: 'plan', objectiveId: 'peaje', employeeName: 'PLANIFICADO',
    code: 'N', isFuture: true, isUnassigned: false,
    shiftDateObj: start(23, 0), endDateObj: end(7, 0),
  },
  {
    id: 'franco', objectiveId: 'peaje', employeeName: 'FRANCO',
    code: 'F', isFranco: true,
    shiftDateObj: start(0, 0), endDateObj: end(23, 59),
  },
  {
    id: 'cubierta', objectiveId: 'otro', employeeName: 'CUBIERTA',
    code: 'T', isAbsent: true, operacionallyCovered: true, isFuture: true,
    shiftDateObj: start(16, 0), endDateObj: end(0, 0),
  },
  {
    id: 'ev-aus', objectiveId: 'base', isEvent: true, eventKey: 'ev1',
    employeeName: 'EVENTO', code: 'EV', isAbsent: true, isFuture: true,
    shiftDateObj: start(18, 0), endDateObj: end(22, 0),
  },
];

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FALLA'}\t${label}`);
}

const bucket = emptyOpsObjectiveBucket();
addShiftToOpsBucket(bucket, shifts[0], now);
check('ausente futuro descubierto suma VAC y AUS', bucket.vacant === 1 && bucket.absent === 1);

for (const tab of OPS_OBJECTIVE_PARITY_TABS) {
  const { list, objectives } = opsTabShiftIds(shifts, tab, now);
  const a = [...list].sort().join(',');
  const b = [...objectives].sort().join(',');
  check(`${tab}: LISTA = OBJ (${a || '—'})`, a === b);
}

const vac = opsTabShiftIds(shifts, 'VACANTES', now);
check('VAC incluye a VENENCIA', vac.list.includes('venencia') && vac.objectives.includes('venencia'));
check('VAC no incluye la ausencia ya cubierta', !vac.list.includes('cubierta'));

function Vista({ ids }) {
  if (!ids.length) return React.createElement('p', null, 'Sin objetivos en este filtro');
  return React.createElement('ul', null, ids.map((id) => React.createElement('li', { key: id }, id)));
}
const html = renderToStaticMarkup(React.createElement(Vista, { ids: vac.objectives }));
check('render VAC muestra el turno y no el vacío', html.includes('venencia') && !html.includes('Sin objetivos en este filtro'));
const vacio = renderToStaticMarkup(React.createElement(Vista, { ids: [] }));
check('render sin turnos dice el vacío', vacio.includes('Sin objetivos en este filtro'));

const page = readFileSync(new URL('../apps/web2/src/pages/admin/operaciones/index.tsx', import.meta.url), 'utf8');
check('OBJ usa objectiveVisibleOnOpsTab', page.includes('objectiveVisibleOnOpsTab(o.shifts || [], logic.viewTab)'));
check('OBJ ya no filtra VAC por el contador exclusivo', !page.includes("case 'VACANTES':  return o.vacant > 0"));
const movil = readFileSync(new URL('../apps/web2/src/lib/movil/operacionFiltros.ts', import.meta.url), 'utf8');
check('celular agrupa con el mismo bucket', movil.includes('addShiftToOpsBucket(grupo, s as never, now)'));
const mapa = readFileSync(new URL('../apps/web2/src/hooks/useOperacionesMonitor.ts', import.meta.url), 'utf8');
check('mapa sale de listData (misma solapa)', mapa.includes('listData.filter((s: any) => !isEventShift(s))'));

if (failed) {
  console.error(`\n${failed} falla(s)`);
  process.exit(1);
}
console.log('\nparidad OBJ/LISTA ok');

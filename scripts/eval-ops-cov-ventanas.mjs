/**
 * Criterio de ventana EXT/ADV sobre el snapshot nuevo-edificio-2026-09-28
 * (incluye Playa 27/09) y casos sintéticos. No escribe Firestore.
 *
 *   node scripts/eval-ops-cov-ventanas.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assessOpsCovWindows, fmtWindow } from './opsCovVentana.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(__dirname, 'out', 'cc-casos', 'nuevo-edificio-2026-09-28.json');

let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failed += 1;
  console.error(`  MAL ${label}${detail ? ` — ${detail}` : ''}`);
}

function ms(iso) {
  return Date.parse(iso);
}

function row(partial) {
  return {
    id: 'x',
    type: 'EXTEND',
    employeeId: 'e',
    name: 'X',
    covStart: 0,
    covEnd: 0,
    sourceId: 's',
    source: null,
    gap: null,
    ...partial,
  };
}

const playaGap = {
  startMs: ms('2026-09-27T07:00:00-03:00'),
  endMs: ms('2026-09-27T15:00:00-03:00'),
  employeeName: 'MORENO',
  positionName: 'Playa',
};
const dur4 = {
  covStart: ms('2026-09-27T04:00:00-03:00'),
  covEnd: ms('2026-09-27T08:00:00-03:00'),
};

const nSource = assessOpsCovWindows([row({
  id: 'liz-n',
  ...dur4,
  source: {
    startMs: ms('2026-09-26T23:00:00-03:00'),
    endMs: ms('2026-09-27T07:00:00-03:00'),
    realStartMs: ms('2026-09-26T23:00:00-03:00'),
    code: 'N',
  },
  gap: playaGap,
})])[0];
check('P1c N saliente', nSource.action === 'propose' && fmtWindow(nSource.proposedStart, nSource.proposedEnd) === '07:00–11:00', fmtWindow(nSource.proposedStart, nSource.proposedEnd));

const franco = assessOpsCovWindows([row({
  id: 'franco',
  type: 'ADVANCE',
  covStart: ms('2026-09-27T20:00:00-03:00'),
  covEnd: ms('2026-09-28T04:00:00-03:00'),
  source: {
    startMs: ms('2026-09-27T00:00:00-03:00'),
    endMs: ms('2026-09-27T23:59:00-03:00'),
    code: 'F',
    isFranco: true,
  },
  gap: {
    startMs: ms('2026-09-26T23:00:00-03:00'),
    endMs: ms('2026-09-27T07:00:00-03:00'),
  },
})])[0];
check('franco no mueve el día', franco.action === 'manual' && franco.reason.includes('franco') && !franco.proposedStart, franco.reason);

const otroDia = assessOpsCovWindows([row({
  id: 'otro',
  ...dur4,
  source: {
    startMs: ms('2026-09-26T15:00:00-03:00'),
    endMs: ms('2026-09-26T23:00:00-03:00'),
    code: 'T',
  },
  gap: playaGap,
})])[0];
check('fuente en otro día', otroDia.action === 'manual' && otroDia.reason.includes('otro día') && !otroDia.proposedStart, otroDia.reason);

if (!fs.existsSync(SNAP)) {
  check('snapshot nuevo-edificio-2026-09-28', false, 'no está en scripts/out/cc-casos');
} else {
  const json = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const docs = json.docs;
  const ts = (v) => (v && typeof v.__ts === 'number' ? v.__ts : 0);
  const turnos = {};
  const convs = {};
  for (const [key, data] of Object.entries(docs)) {
    if (key.startsWith('turnos/')) turnos[key.slice(7)] = data;
    if (key.startsWith('convocatorias_cobertura/')) convs[key.split('/')[1]] = data;
  }
  const { linkedSourceId, gapShiftId } = await import('./opsCovVentana.mjs');
  const built = [];
  for (const [id, t] of Object.entries(turnos)) {
    const type = String(t.coverageType || '').toUpperCase();
    if (t.origin !== 'OPERATIONS_COVERAGE') continue;
    if (type !== 'EXTEND' && type !== 'ADVANCE') continue;
    if (t.coverageSuperseded === true) continue;
    const conv = t.assignedByConvocatoria ? convs[t.assignedByConvocatoria] : null;
    const sourceId = linkedSourceId(t, conv);
    const gapId = gapShiftId(t);
    const src = turnos[sourceId];
    const gap = turnos[gapId];
    built.push({
      id,
      type,
      name: t.employeeName || '',
      employeeId: t.employeeId || '',
      covStart: ts(t.startTime),
      covEnd: ts(t.endTime),
      sourceId,
      sourceMissing: !!sourceId && !src,
      source: src ? {
        startMs: ts(src.startTime),
        endMs: ts(src.endTime),
        realStartMs: ts(src.realStartTime) || 0,
        code: src.code || '',
        isFranco: src.isFranco === true,
      } : null,
      gap: gap ? {
        startMs: ts(gap.startTime),
        endMs: ts(gap.endTime),
        employeeName: gap.employeeName || '',
        positionName: gap.positionName || '',
      } : null,
    });
  }
  const byId = Object.fromEntries(assessOpsCovWindows(built).map((r) => [r.id, r]));
  const liz = byId.ops_cov_W4eC9clqG6qpY9llgj4m_hUo6Nmw7rdzVONiCKHgW;
  const bus = byId.ops_cov_W4eC9clqG6qpY9llgj4m_6B6w3gYy8kelK3rzN6O8;
  const qui = byId.ops_cov_nPpF1zcL5I4t5z6cx0gi_F7bYgkiu9m7403dHnGOI;
  const ram = byId.ops_cov_rMdDJxgdwpibFWC1ESKa_F7bYgkiu9m7403dHnGOI;
  const mor = byId.ops_cov_6FWHN5fqMpoE2fkrbSPV_BebzoMsfAw0soEgYrdaS;
  check('Playa Lizarraga EXT 07:00–11:00', liz?.action === 'propose' && fmtWindow(liz.proposedStart, liz.proposedEnd) === '07:00–11:00', fmtWindow(liz?.proposedStart, liz?.proposedEnd));
  check('Playa Bustamante ADV 11:00–15:00', bus?.action === 'propose' && fmtWindow(bus.proposedStart, bus.proposedEnd) === '11:00–15:00', fmtWindow(bus?.proposedStart, bus?.proposedEnd));
  check('Nuevo Edificio Quiroga ADV 11:00–15:00', qui?.action === 'propose' && fmtWindow(qui.proposedStart, qui.proposedEnd) === '11:00–15:00', fmtWindow(qui?.proposedStart, qui?.proposedEnd));
  check('Nuevo Edificio Ramos ANULAR', ram?.action === 'anular' && /Ramos/i.test(ram.reason) && /Bunker/i.test(ram.reason) && !ram.proposedStart, ram?.reason);
  check('Morillo no cambia de día', mor?.action === 'manual' && !mor.proposedStart && !/16:00/.test(fmtWindow(mor.proposedStart, mor.proposedEnd)), mor?.reason);
}

if (failed) {
  console.error(`${failed} fallo(s)`);
  process.exit(1);
}
console.log('criterio OK');

/**
 * S8 — vigencia por meses: agrupados (1 doc) vs individuales (1 por mes), parciales,
 * solape con un SLA existente y fecha hasta anterior a desde.
 *
 *   node --experimental-strip-types scripts/eval-s8-servicios-meses.mjs
 */
import {
  buildSlaDraftsForSegments,
  overlappingSegments,
  slaSegmentsForMode,
  splitRangeByCalendarMonth,
  summarizeSlaSplit,
  validateSlaRange,
} from '../apps/web2/src/lib/servicios/slaMonthSplit.ts';

let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ok ${label}`);
  else {
    failed += 1;
    console.error(`  FAIL ${label}${extra ? ` → ${extra}` : ''}`);
  }
};

// Fecha invertida
check('hasta < desde rechaza', validateSlaRange('2026-11-01', '2026-04-01') === 'La fecha hasta (01/04/2026) es anterior a la fecha desde (01/11/2026)', validateSlaRange('2026-11-01', '2026-04-01'));
check('falta fecha', validateSlaRange('2026-11-01', '') === 'Completá la fecha desde y la fecha hasta');
check('mismo día es válido', validateSlaRange('2026-11-01', '2026-11-01') === null);
check('rango válido', validateSlaRange('2026-11-01', '2027-03-31') === null);
check('segmentos vacíos con rango inválido', splitRangeByCalendarMonth('2026-11-01', '2026-04-01').length === 0);

// Agrupados vs individuales (01/11/2026 → 31/03/2027)
const grouped = slaSegmentsForMode('agrupados', '2026-11-01', '2027-03-31');
check('agrupados = 1 segmento con toda la vigencia', grouped.length === 1 && grouped[0].startDate === '2026-11-01' && grouped[0].endDate === '2027-03-31');

const individual = slaSegmentsForMode('individuales', '2026-11-01', '2027-03-31');
check('individuales = 5 meses', individual.length === 5, String(individual.length));
check('meses encadenados sin huecos', individual.every((s, i) => i === 0 || s.startDate > individual[i - 1].endDate));
check('cada mes 1 → último día', individual.every((s) => s.startDate.endsWith('-01') && !s.partial));
check('cruza el año', individual[2].monthKey === '2027-01' && individual[4].endDate === '2027-03-31');
check('resumen', summarizeSlaSplit(individual) === 'Se van a crear 5 servicios: nov 2026, dic 2026, ene 2027, feb 2027, mar 2027', summarizeSlaSplit(individual));

// Parciales (15/11/2026 → 10/03/2027)
const partial = splitRangeByCalendarMonth('2026-11-15', '2027-03-10');
check('primer mes arranca en desde', partial[0].startDate === '2026-11-15' && partial[0].endDate === '2026-11-30' && partial[0].partial);
check('último mes termina en hasta', partial[4].startDate === '2027-03-01' && partial[4].endDate === '2027-03-10' && partial[4].partial);
check('los del medio completos', partial.slice(1, 4).every((s) => !s.partial));
check('un solo mes parcial', splitRangeByCalendarMonth('2026-11-05', '2026-11-20').length === 1);

// Misma estructura en cada borrador
const base = {
  clientId: 'c1',
  objectiveId: 'o1',
  positions: [{ id: 'p1', name: 'Puesto 1', quantity: 2 }],
  billingMode: 'EJECUTADO',
  startDate: '2026-11-01',
  endDate: '2027-03-31',
};
const drafts = buildSlaDraftsForSegments(base, individual, 'serie_x');
check('5 borradores con misma estructura', drafts.length === 5 && drafts.every((d) => d.positions === base.positions && d.billingMode === 'EJECUTADO' && d.slaSeriesId === 'serie_x'));
check('cada borrador con su vigencia', drafts[1].startDate === '2026-12-01' && drafts[1].endDate === '2026-12-31');
const single = buildSlaDraftsForSegments(base, grouped, 'serie_x');
check('agrupado no lleva serie', single.length === 1 && !('slaSeriesId' in single[0]));

// Solape: ya existe enero para el mismo objetivo
const existing = [
  { id: 'a', clientId: 'c1', objectiveId: 'o1', startDate: '2027-01-01', endDate: '2027-01-31' },
  { id: 'b', clientId: 'c1', objectiveId: 'o2', startDate: '2026-11-01', endDate: '2027-03-31' },
  { id: 'c', clientId: 'c1', objectiveId: 'o1', startDate: '2026-10-01', endDate: '2026-10-31' },
];
const clash = overlappingSegments(individual, existing, { clientId: 'c1', objectiveId: 'o1' });
check('avisa solo el mes que pisa (ene)', clash.length === 1 && clash[0].label === 'ene 2027', clash.map((s) => s.label).join(','));
check('otro objetivo no cuenta', overlappingSegments(individual, existing.filter((e) => e.id === 'b'), { clientId: 'c1', objectiveId: 'o1' }).length === 0);
check('octubre contiguo no solapa', overlappingSegments(individual, existing.filter((e) => e.id === 'c'), { clientId: 'c1', objectiveId: 'o1' }).length === 0);
check('el propio doc no cuenta al editar', overlappingSegments(individual, existing, { clientId: 'c1', objectiveId: 'o1' }, 'a').length === 0);
check('agrupado también detecta el solape', overlappingSegments(grouped, existing, { clientId: 'c1', objectiveId: 'o1' }).length === 1);

if (failed) {
  console.error(`S8_SERVICIOS_MESES_FAIL ${failed}`);
  process.exit(1);
}
console.log('S8_SERVICIOS_MESES_OK');

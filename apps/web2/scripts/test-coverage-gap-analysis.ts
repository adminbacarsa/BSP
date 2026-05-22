/**
 * Test diagnóstico cobertura — 4 puestos 24hs (Misericordia-like).
 * npx tsx scripts/test-coverage-gap-analysis.ts
 */
import {
    analyzeDayCoverageGaps,
    analyzePositionDayGap,
} from '../src/lib/planificacion/coverageGapAnalysis';

const POSITIONS = [
    { positionName: 'Puesto 1', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }, { code: 'D12', hours: 12 }, { code: 'N12', hours: 12 }] },
    { positionName: 'Puesto 2', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }, { code: 'D12', hours: 12 }, { code: 'N12', hours: 12 }] },
    { positionName: '136', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }, { code: 'D12', hours: 12 }, { code: 'N12', hours: 12 }] },
    { positionName: 'Internado', qty: 1, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }, { code: 'D12', hours: 12 }, { code: 'N12', hours: 12 }] },
];

const day1Counts: Record<string, Record<string, number>> = {
    'Puesto 1': { M: 4, T: 2, N: 4 },
    'Puesto 2': {},
    '136': {},
    'Internado': {},
};

console.log('=== Día 1 — turnos sin repartir por puesto ===\n');
const day1 = analyzeDayCoverageGaps(POSITIONS, '2026-06-01', 'L', day1Counts);
console.log(`Pie: ${day1.closed}/${day1.required}`);
for (const g of day1.positions) {
    console.log(`  ${g.positionName}: ${g.closed}/${g.required} → ${g.summary}`);
}

console.log('\n=== Día perfecto — 4M+4T+4N repartidos ===\n');
const perfectCounts: Record<string, Record<string, number>> = {
    'Puesto 1': { M: 1, T: 1, N: 1 },
    'Puesto 2': { M: 1, T: 1, N: 1 },
    '136': { M: 1, T: 1, N: 1 },
    'Internado': { M: 1, T: 1, N: 1 },
};
const perfect = analyzeDayCoverageGaps(POSITIONS, '2026-06-02', 'M', perfectCounts);
console.log(`Pie: ${perfect.closed}/${perfect.required} (isFull=${perfect.isFull})`);

console.log('\n=== Puesto 2 — falta T ===\n');
const g2 = analyzePositionDayGap(POSITIONS[1], 'L', { M: 1, N: 1 }, ['6+2']);
console.log(g2?.summary);

console.log('\nOK');

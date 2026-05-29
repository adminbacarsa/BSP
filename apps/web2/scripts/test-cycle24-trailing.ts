/** Verifica inferJune1CycleSlot vs grupos Misericordia mayo→junio. */
import { inferJune1CycleSlot, CYCLE_24_MTN } from '../src/lib/planificacion/fixedBandFloaterScheduleEngine';

const cases = [
    { name: 'Grp A (6N→F)', last: 'N', tw: 6, expect: 22 },
    { name: 'Grp B (2F→N)', last: 'F', tr: 2, bandBefore: 'T', expect: 16 },
    { name: 'Grp C (T×2)', last: 'T', tw: 2, expect: 10 },
    { name: 'Grp D (M×4)', last: 'M', tw: 4, expect: 4 },
];

let ok = true;
for (const c of cases) {
    const got = inferJune1CycleSlot(c.last, c.tw, c.tr, (c as any).bandBefore);
    const pass = got === c.expect;
    if (!pass) ok = false;
    console.log(pass ? 'OK' : 'FAIL', c.name, 'got', got, 'expect', c.expect, '→ jun1', CYCLE_24_MTN[c.expect!]);
}

// Día 1 cobertura global: 4 grupos escalonados
const openings = cases.map(c => c.expect!);
const day1 = openings.map(o => CYCLE_24_MTN[o]);
console.log('day1 bands', day1.sort().join(','));
console.log(ok && day1.sort().join(',') === 'F,M,N,T' ? 'PASS trailing' : 'FAIL trailing');
process.exit(ok ? 0 : 1);

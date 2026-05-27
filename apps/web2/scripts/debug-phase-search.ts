/** npx tsx scripts/debug-phase-search.ts */
const cL = 6, cF = 2, cycleLen = 8;
const ring = ['M', 'T', 'N'];
const ringLen = 3;
const period = 2 * (ringLen - 1);
const monthStart = 2343;
const dayCount = 30;
const slotsPerBand = 4;
const n = 16;

function expectedBand(offset: number, slot: number, absDay: number): string | null {
    const cycleSlot = (absDay + offset) % cycleLen;
    if (cycleSlot >= cL) return null;
    const pendulumBlock = Math.floor((absDay + offset - cycleSlot) / cycleLen);
    const pos = (slot + pendulumBlock) % period;
    const idx = pos < ringLen ? pos : period - pos;
    return ring[idx];
}

function score(getOffset: (i: number) => number, getSlot: (i: number) => number): number {
    let total = 0;
    for (let di = 0; di < dayCount; di++) {
        const absDay = monthStart + di;
        const counts: Record<string, number> = { M: 0, T: 0, N: 0 };
        for (let i = 0; i < n; i++) {
            const band = expectedBand(getOffset(i), getSlot(i), absDay);
            if (band) counts[band]++;
        }
        for (const b of ring) total += Math.min(counts[b], slotsPerBand);
    }
    return total;
}

let best = { s: -1, G: 0, ss: 0, spread: 1, mode: '' };

for (let G = 0; G < cycleLen; G++) {
    for (let ss = 0; ss < ringLen; ss++) {
        for (const spread of [1, 2, 4]) {
            const s1 = score(
                i => (Math.floor(i / ringLen) * spread + (i % ringLen) + G) % cycleLen,
                i => (i + ss) % ringLen,
            );
            if (s1 > best.s) best = { s: s1, G, ss, spread, mode: 'cuadrilla' };

            const s2 = score(i => (i + G) % cycleLen, i => (i + ss) % ringLen);
            if (s2 > best.s) best = { s: s2, G, ss, spread: 0, mode: 'linear' };
        }
    }
}

console.log('best:', best, 'max possible:', dayCount * 3 * slotsPerBand);

// Greedy coordinate descent: each emp picks best (offset, slot)
const offsets = new Array(n).fill(0);
const slots = new Array(n).fill(0);
for (let iter = 0; iter < 8; iter++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
        let bestLocal = -1;
        let bo = offsets[i], bs = slots[i];
        for (let o = 0; o < cycleLen; o++) {
            for (let s = 0; s < ringLen; s++) {
                offsets[i] = o; slots[i] = s;
                const sc = score(j => offsets[j], j => slots[j]);
                if (sc > bestLocal) { bestLocal = sc; bo = o; bs = s; }
            }
        }
        if (bo !== offsets[i] || bs !== slots[i]) improved = true;
        offsets[i] = bo; slots[i] = bs;
    }
    if (!improved) break;
}
const finalScore = score(i => offsets[i], i => slots[i]);
console.log('greedy score:', finalScore, '/', dayCount * 3 * slotsPerBand);
for (let di = 0; di < 5; di++) {
    const absDay = monthStart + di;
    const counts: Record<string, number> = { M: 0, T: 0, N: 0, F: 0 };
    for (let i = 0; i < n; i++) {
        const band = expectedBand(offsets[i], slots[i], absDay);
        if (band) counts[band]++;
        else counts.F++;
    }
    console.log(`greedy di=${di} abs%8=${absDay % 8}:`, counts);
}

const getOffset = best.mode === 'cuadrilla'
    ? (i: number) => (Math.floor(i / ringLen) * best.spread + (i % ringLen) + best.G) % cycleLen
    : (i: number) => (i + best.G) % cycleLen;
const getSlot = (i: number) => (i + best.ss) % ringLen;

for (let di = 0; di < 5; di++) {
    const absDay = monthStart + di;
    const counts: Record<string, number> = { M: 0, T: 0, N: 0, F: 0 };
    for (let i = 0; i < n; i++) {
        const band = expectedBand(getOffset(i), getSlot(i), absDay);
        if (band) counts[band]++;
        else counts.F++;
    }
    console.log(`di=${di} abs%8=${absDay % 8}:`, counts);
}

/** npx tsx scripts/debug-team-phase.ts */
const cL = 6, cycleLen = 8;
const ring = ['M', 'T', 'N'];
const ringLen = 3;
const period = 4;
const monthStart = 2343;
const dayCount = 30;
const slotsPerBand = 4;

function expectedBand(offset: number, slot: number, absDay: number): string | null {
    const cycleSlot = (absDay + offset) % cycleLen;
    if (cycleSlot >= cL) return null;
    const pendulumBlock = Math.floor((absDay + offset - cycleSlot) / cycleLen);
    const pos = (slot + pendulumBlock) % period;
    const idx = pos < ringLen ? pos : period - pos;
    return ring[idx];
}

function scoreAll(offsets: number[], slots: number[]): number {
    let total = 0;
    for (let di = 0; di < dayCount; di++) {
        const absDay = monthStart + di;
        const counts: Record<string, number> = { M: 0, T: 0, N: 0 };
        for (let i = 0; i < offsets.length; i++) {
            const band = expectedBand(offsets[i], slots[i], absDay);
            if (band) counts[band]++;
        }
        for (const b of ring) total += Math.min(counts[b], slotsPerBand);
    }
    return total;
}

const posBases = [0, 2, 4, 6];
let best = { s: -1, G: 0, slotShift: 0 };

for (let G = 0; G < cycleLen; G++) {
    for (let slotShift = 0; slotShift < ringLen; slotShift++) {
        const offsets: number[] = [];
        const slots: number[] = [];
        for (let pi = 0; pi < 4; pi++) {
            for (let sj = 0; sj < 4; sj++) {
                offsets.push((posBases[pi] + sj + G) % cycleLen);
                slots.push((sj + slotShift) % ringLen);
            }
        }
        const s = scoreAll(offsets, slots);
        if (s > best.s) best = { s, G, slotShift };
    }
}

console.log('team phase best:', best, 'max:', dayCount * 3 * slotsPerBand);

const offsets: number[] = [];
const slots: number[] = [];
for (let pi = 0; pi < 4; pi++) {
    for (let sj = 0; sj < 4; sj++) {
        offsets.push((posBases[pi] + sj + best.G) % cycleLen);
        slots.push((sj + best.slotShift) % ringLen);
    }
}

for (let di = 0; di < 6; di++) {
    const absDay = monthStart + di;
    const counts: Record<string, number> = { M: 0, T: 0, N: 0, F: 0 };
    for (let i = 0; i < 16; i++) {
        const band = expectedBand(offsets[i], slots[i], absDay);
        if (band) counts[band]++;
        else counts.F++;
    }
    console.log(`di=${di} abs%8=${absDay % 8}:`, counts);
}

// slotShift +1 variant
for (let slotShift of [1]) {
    const o2: number[] = [], s2: number[] = [];
    for (let pi = 0; pi < 4; pi++) {
        for (let sj = 0; sj < 4; sj++) {
            o2.push((posBases[pi] + sj + best.G) % cycleLen);
            s2.push((sj + slotShift) % ringLen);
        }
    }
    console.log('score slotShift=1:', scoreAll(o2, s2));
    for (let di = 0; di < 3; di++) {
        const absDay = monthStart + di;
        const counts: Record<string, number> = { M: 0, T: 0, N: 0, F: 0 };
        for (let i = 0; i < 16; i++) {
            const band = expectedBand(o2[i], s2[i], absDay);
            if (band) counts[band]++;
            else counts.F++;
        }
        console.log(`  shift1 di=${di}:`, counts);
    }
}

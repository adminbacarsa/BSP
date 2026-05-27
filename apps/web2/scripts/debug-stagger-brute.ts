const ring = ['M', 'T', 'N'];
const pendulumPeriod = 4;
const cL = 6, cycleLen = 8;
const monthStart = 2343;

function expected(phaseSlot: number, offset: number, di: number): string | null {
    const absDay = monthStart + di;
    if ((absDay + offset) % cycleLen >= cL) return null;
    const blockNum = Math.floor((absDay + offset) / cycleLen);
    const pos = (phaseSlot + blockNum) % pendulumPeriod;
    const idx = pos < ring.length ? pos : pendulumPeriod - pos;
    return ring[idx];
}

function scoreBases(bases: number[]) {
    let totalM = 0, totalT = 0, totalN = 0, totalF = 0, badDays = 0;
    for (let di = 0; di < 30; di++) {
        const c = { M: 0, T: 0, N: 0, F: 0 };
        for (let pi = 0; pi < 4; pi++) {
            for (let ki = 0; ki < 4; ki++) {
                const off = (bases[pi] + ki) % cycleLen;
                const phase = ki % pendulumPeriod;
                const exp = expected(phase, off, di);
                if (!exp) c.F++;
                else c[exp as 'M' | 'T' | 'N']++;
            }
        }
        if (c.M !== 4 || c.T !== 4 || c.N !== 4 || c.F !== 4) badDays++;
        totalM += c.M; totalT += c.T; totalN += c.N; totalF += c.F;
    }
    return { badDays, totalM, totalT, totalN, totalF, bases };
}

let best = { badDays: 999, bases: [] as number[] };
for (let b0 = 0; b0 < 8; b0++) {
    for (let b1 = 0; b1 < 8; b1++) {
        for (let b2 = 0; b2 < 8; b2++) {
            for (let b3 = 0; b3 < 8; b3++) {
                const s = scoreBases([b0, b1, b2, b3]);
                if (s.badDays < best.badDays || (s.badDays === best.badDays && s.totalM + s.totalN > best.totalM + best.totalN)) {
                    best = s;
                }
            }
        }
    }
}
console.log('best', best);

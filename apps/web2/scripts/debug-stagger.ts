const ring = ['M', 'T', 'N'];
const period = 4;
const cL = 6, cycleLen = 8;
const monthStart = 2343;

function bandOld(phase: number, offset: number, di: number): string | null {
    const absDay = monthStart + di;
    if ((absDay + offset) % cycleLen >= cL) return null;
    const blockNum = Math.floor((absDay + offset) / cycleLen);
    const pos = (phase + blockNum) % period;
    const idx = pos < ring.length ? pos : period - pos;
    return ring[idx];
}

function bandNew(phase: number, offset: number, di: number): string | null {
    const absDay = monthStart + di;
    const cycleSlot = (absDay + offset) % cycleLen;
    if (cycleSlot >= cL) return null;
    const cycleStartAbs = absDay + offset - cycleSlot;
    const pendulumBlock = Math.floor(cycleStartAbs / cycleLen);
    const pos = (phase + pendulumBlock) % period;
    const idx = pos < ring.length ? pos : period - pos;
    return ring[idx];
}

function score(fn: typeof bandOld, label: string) {
    let bad = 0, m = 0, t = 0, n = 0;
    for (let di = 0; di < 30; di++) {
        const c = { M: 0, T: 0, N: 0, F: 0 };
        for (let g = 0; g < 4; g++) {
            for (let p = 0; p < 4; p++) {
                const off = (g * 2) % cycleLen;
                const phase = g;
                const exp = fn(phase, off, di);
                if (!exp) c.F++;
                else c[exp as 'M' | 'T' | 'N']++;
            }
        }
        if (c.M !== 4 || c.T !== 4 || c.N !== 4 || c.F !== 4) bad++;
        m += c.M; t += c.T; n += c.N;
    }
    console.log(label, { bad, m, t, n });
}

score(bandOld, 'cuadrilla old blockNum');
score(bandNew, 'cuadrilla cycleStartAbs');

// i%8 i%3 global with 4 phases
function scoreGlobal(fn: typeof bandOld) {
    let bad = 0, m = 0, t = 0, n = 0;
    for (let di = 0; di < 30; di++) {
        const c = { M: 0, T: 0, N: 0, F: 0 };
        for (let i = 0; i < 16; i++) {
            const exp = fn(i % period, i % cycleLen, di);
            if (!exp) c.F++;
            else c[exp as 'M' | 'T' | 'N']++;
        }
        if (c.M !== 4 || c.T !== 4 || c.N !== 4 || c.F !== 4) bad++;
        m += c.M; t += c.T; n += c.N;
    }
    console.log('global i%4 i%8', fn.name, { bad, m, t, n });
}
scoreGlobal(bandOld);
scoreGlobal(bandNew);

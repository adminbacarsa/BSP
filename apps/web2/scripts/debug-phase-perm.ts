const ring = ['M', 'T', 'N'];
const period = 4, cL = 6, cl = 8, ms = 2343;

function band(ph: number, off: number, di: number): string | null {
    const a = ms + di;
    const cs = (a + off) % cl;
    if (cs >= cL) return null;
    const cs0 = a + off - cs;
    const pb = Math.floor(cs0 / cl);
    const pos = (ph + pb) % period;
    const i = pos < 3 ? pos : period - pos;
    return ring[i];
}

function permute(arr: number[]): number[][] {
    if (arr.length <= 1) return [arr];
    const out: number[][] = [];
    for (let i = 0; i < arr.length; i++) {
        for (const rest of permute(arr.slice(0, i).concat(arr.slice(i + 1)))) {
            out.push([arr[i], ...rest]);
        }
    }
    return out;
}

let best = { fail: 99, perm: [] as number[], m: 0, t: 0, n: 0 };
for (const phasePerm of permute([0, 1, 2, 3])) {
    let fail = 0, m = 0, t = 0, n = 0;
    for (let di = 0; di < 30; di++) {
        const b: string[] = [];
        for (let ki = 0; ki < 4; ki++) {
            const x = band(phasePerm[ki], ki, di);
            if (x) b.push(x);
        }
        const mc = b.filter(x => x === 'M').length;
        const tc = b.filter(x => x === 'T').length;
        const nc = b.filter(x => x === 'N').length;
        if (mc !== 1 || tc !== 1 || nc !== 1) fail++;
        m += mc; t += tc; n += nc;
    }
    if (fail < best.fail) best = { fail, perm: phasePerm, m, t, n };
}

console.log('single position best', best);

// 4 positions same perm, offsets 0,1,2,3 each
const pp = best.perm;
let bad = 0, tm = 0, tt = 0, tn = 0;
for (let di = 0; di < 30; di++) {
    const c = { M: 0, T: 0, N: 0, F: 0 };
    for (let pi = 0; pi < 4; pi++) {
        for (let ki = 0; ki < 4; ki++) {
            const x = band(pp[ki], ki, di);
            if (!x) c.F++;
            else c[x as 'M' | 'T' | 'N']++;
        }
    }
    if (c.M !== 4 || c.T !== 4 || c.N !== 4 || c.F !== 4) bad++;
    tm += c.M; tt += c.T; tn += c.N;
}
console.log('4 positions identical', { bad, tm, tt, tn });

// stagger position bases 0,4,0,4 with ki offsets
bad = 0; tm = 0; tt = 0; tn = 0;
for (let di = 0; di < 30; di++) {
    const c = { M: 0, T: 0, N: 0, F: 0 };
    for (let pi = 0; pi < 4; pi++) {
        const base = (pi % 2) * 4;
        for (let ki = 0; ki < 4; ki++) {
            const x = band(pp[ki], (base + ki) % cl, di);
            if (!x) c.F++;
            else c[x as 'M' | 'T' | 'N']++;
        }
    }
    if (c.M !== 4 || c.T !== 4 || c.N !== 4 || c.F !== 4) bad++;
    tm += c.M; tt += c.T; tn += c.N;
}
console.log('4 positions stagger base 0,4', { bad, tm, tt, tn });

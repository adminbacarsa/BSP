/**
 * Medición de «Continuar desde el mes anterior» contra planillas ya canonizadas (solo lectura, sin datos en el repo).
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/continuar-mes/medir-planillas.mts RUTA/canon.json [--desde 1] [--hasta 9]
 *
 * canon.json: { "<mes>": { plan: {id: {dia: [cat, code]}}, vig: {...}, orden: [id] } } con ids anónimos.
 * cat: WORK | F | RET | LIC | EV | FT | OTRO | COB | UNK. Métrica: celdas del mes destino (plan inicial) salvo LIC/EV/UNK;
 * cobertura (FT/OTRO/COB) cuenta como error; altas fuera. Coincidencia exacta de código.
 */
import { readFileSync } from 'node:fs';
import {
  proponerContinuacion,
  type ContinuarInput,
  type CupoDia,
  type PuestoSla,
  type ResultadoGuardia,
} from '../../apps/web2/src/lib/planificacion/continuarMesAnterior';

type Celda = [string, string];
type Mes = { plan: Record<string, Record<string, Celda>>; vig: Record<string, Record<string, Celda>>; orden: string[] };

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
if (!ruta) throw new Error('Falta la ruta al canon.json');
const opt = (k: string, d: number) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const ANIO = opt('anio', 2026);
const C: Record<string, Mes> = JSON.parse(readFileSync(ruta, 'utf8'));
const meses = Object.keys(C).map(Number).sort((a, b) => a - b);
const desde = opt('desde', meses[0]);
const hasta = opt('hasta', meses[meses.length - 1] - 1);

const ymd = (m: number, d: number) => `${ANIO}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nDias = (m: number) => new Date(Date.UTC(ANIO, m, 0)).getUTCDate();
const POS = 'P';
const estructura: PuestoSla[] = [{
  positionName: POS,
  qty: 1,
  shifts: [
    { code: 'M', hours: 8, startTime: '06:00', endTime: '14:00' },
    { code: 'T', hours: 8, startTime: '14:00', endTime: '22:00' },
    { code: 'N', hours: 8, startTime: '22:00', endTime: '06:00' },
    { code: 'D12', hours: 12, startTime: '06:00', endTime: '18:00' },
    { code: 'N12', hours: 12, startTime: '18:00', endTime: '06:00' },
    { code: 'RET', hours: 8, startTime: '06:00', endTime: '14:00' },
  ],
}];
const CICLO = new Set(['WORK', 'F', 'RET']);
const ENDOT = new Set(['WORK', 'F', 'RET', 'LIC', 'FT', 'OTRO', 'COB', 'EV']);
const COBERT = new Set(['FT', 'OTRO', 'COB']);

const FUENTE = (() => {
  const i = args.indexOf('--fuente');
  return i >= 0 ? args[i + 1] : 'plan';
})();

/** Las altas no se predicen; con `dato` (como el análisis) sus filas del destino cuentan como ya cargadas para el cupo. */
const ALTAS_DATO = (() => {
  const i = args.indexOf('--altas');
  return i < 0 || args[i + 1] !== 'no';
})();

/** Historia = plan inicial de cada mes (lo que Mauro pide como base); VIG solo donde el plan no tiene la fila. */
function celdasHistoria(mm: number, id: string): Record<string, Celda> {
  const plan = C[mm]?.plan[id];
  const vig = C[mm]?.vig[id] || {};
  if (FUENTE === 'vig' || !plan) return vig;
  if (FUENTE === 'plan') return plan;
  return { ...vig, ...plan };
}

function previosDe(id: string, m: number) {
  const out: Array<{ dateStr: string; code: string; positionName: string; objectiveId: string }> = [];
  for (let mm = Math.max(meses[0], m - 2); mm <= m; mm += 1) {
    for (const [d, [cat, code]] of Object.entries(celdasHistoria(mm, id))) {
      if (CICLO.has(cat)) out.push({ dateStr: ymd(mm, Number(d)), code, positionName: code === 'F' ? 'General' : POS, objectiveId: 'obj' });
    }
  }
  return out.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

function cupoProxy(t: number): (ds: string) => CupoDia {
  const porDow = new Map<number, Array<CupoDia>>();
  for (let d = 1; d <= nDias(t); d += 1) {
    const c: CupoDia = { M: 0, T: 0, N: 0 };
    for (const cs of Object.values(C[t].plan)) {
      const x = cs[String(d)];
      if (!x || x[0] !== 'WORK') continue;
      const code = x[1];
      if (code === 'D12') { c.M += 1; c.T += 0.5; } else if (code === 'N12') { c.N += 1; c.T += 0.5; } else {
        const b = code[0] as 'M' | 'T' | 'N';
        if (b in c) c[b] += 1;
      }
    }
    const dow = new Date(`${ymd(t, d)}T12:00:00Z`).getUTCDay();
    porDow.set(dow, [...(porDow.get(dow) || []), c]);
  }
  const moda = (xs: number[]) => {
    const n = new Map<number, number>();
    xs.forEach((x) => n.set(x, (n.get(x) || 0) + 1));
    return [...n].sort((a, b) => b[1] - a[1])[0][0];
  };
  const cup = new Map<number, CupoDia>();
  for (const [dow, cs] of porDow) cup.set(dow, { M: moda(cs.map((c) => c.M)), T: moda(cs.map((c) => c.T)), N: moda(cs.map((c) => c.N)) });
  return (ds) => cup.get(new Date(`${ds}T12:00:00Z`).getUTCDay())!;
}

function predicho(res: ResultadoGuardia, conSugerencias: boolean): Map<string, string> {
  const out = new Map(res.propuestas.map((c) => [c.dateStr, c.isFranco ? 'F' : c.code]));
  if (conSugerencias) for (const s of res.sugerencias) out.set(s.dateStr, s.a);
  return out;
}

type Fila = { m: number; n: number; anterior: number; c2: number; c2niv: number; vias: Record<string, number> };
const filas: Fila[] = [];
for (let m = desde; m <= hasta; m += 1) {
  const t = m + 1;
  if (!C[t] || !C[m]) continue;
  const enOrigen = new Set(Object.entries(C[m].vig).filter(([, cs]) => Object.values(cs).some(([cat]) => ENDOT.has(cat))).map(([id]) => id));
  const destino = Object.keys(C[t].plan);
  const orden = [...C[t].orden.filter((id) => destino.includes(id)), ...destino.filter((id) => !C[t].orden.includes(id))];
  const dotacion = orden.filter((id) => enOrigen.has(id));
  const altas = new Set(orden.filter((id) => !enOrigen.has(id)));
  const salientes = [...enOrigen].filter((id) => !destino.includes(id));
  const dias = Array.from({ length: nDias(t) }, (_, i) => ymd(t, i + 1));
  const celdaDestino = (id: string, ds: string) => C[t].plan[id]?.[String(Number(ds.slice(8)))];
  const base: ContinuarInput = {
    objectiveId: 'obj',
    dias,
    guardias: (ALTAS_DATO ? orden : dotacion).map((id) => ({ id, nombre: id, previos: altas.has(id) ? [] : previosDe(id, m) })),
    salientes: salientes.map((id) => ({ id, nombre: id, previos: previosDe(id, m) })),
    estructura,
    estadoCelda: (id, ds) => {
      const x = celdaDestino(id, ds);
      if (x && (x[0] === 'LIC' || x[0] === 'EV')) return 'licencia';
      return altas.has(id) && x ? 'ocupada' : null;
    },
    turnoHabilitado: () => true,
    cupoDia: cupoProxy(t),
    cargado: ALTAS_DATO ? (id, ds) => {
      const x = celdaDestino(id, ds);
      return altas.has(id) && x && x[0] === 'WORK' ? x[1] : null;
    } : null,
  };
  const ant = proponerContinuacion({ ...base, regla: 'anterior' });
  const nuevo = proponerContinuacion(base);
  if (args.includes('--ver-niv') && opt('ver-niv', 0) === m) {
    for (const r of nuevo) for (const s of r.sugerencias) console.log(s.dateStr.slice(8), r.employeeId, s.de, '->', s.a, 'real', celdaDestino(r.employeeId, s.dateStr)?.[1]);
  }
  const fila: Fila = { m, n: 0, anterior: 0, c2: 0, c2niv: 0, vias: {} };
  for (const r of nuevo) {
    const via = r.plantilla?.via || `anterior:${r.origenCiclo || 'sin ciclo'}`;
    fila.vias[via] = (fila.vias[via] || 0) + 1;
  }
  const pa = new Map(ant.map((r) => [r.employeeId, predicho(r, false)]));
  const pn = new Map(nuevo.map((r) => [r.employeeId, predicho(r, false)]));
  const pv = new Map(nuevo.map((r) => [r.employeeId, predicho(r, true)]));
  for (const id of dotacion) {
    for (const [d, [cat, code]] of Object.entries(C[t].plan[id] || {})) {
      if (cat === 'LIC' || cat === 'EV' || cat === 'UNK') continue;
      fila.n += 1;
      if (COBERT.has(cat)) continue;
      const ds = ymd(t, Number(d));
      if (pa.get(id)?.get(ds) === code) fila.anterior += 1;
      if (pn.get(id)?.get(ds) === code) fila.c2 += 1;
      if (pv.get(id)?.get(ds) === code) fila.c2niv += 1;
    }
  }
  filas.push(fila);
}

const pct = (a: number, n: number) => (n ? ((100 * a) / n).toFixed(1).padStart(5) : '  —  ');
const MES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
console.log('transición   celdas  anterior     c2  c2+niv   vías c2');
for (const f of filas) {
  console.log(`${MES[f.m]}→${MES[f.m + 1]}`.padEnd(12), String(f.n).padStart(6), pct(f.anterior, f.n).padStart(9), pct(f.c2, f.n).padStart(6), pct(f.c2niv, f.n).padStart(7), '  ', JSON.stringify(f.vias));
}
const tot = (k: 'anterior' | 'c2' | 'c2niv', fs: Fila[]) => pct(fs.reduce((s, f) => s + f[k], 0), fs.reduce((s, f) => s + f.n, 0));
console.log('total'.padEnd(12), String(filas.reduce((s, f) => s + f.n, 0)).padStart(6), tot('anterior', filas).padStart(9), tot('c2', filas).padStart(6), tot('c2niv', filas).padStart(7));
const desdeAbr = filas.filter((f) => f.m >= 4);
if (desdeAbr.length && desdeAbr.length < filas.length) {
  console.log('abr→fin'.padEnd(12), String(desdeAbr.reduce((s, f) => s + f.n, 0)).padStart(6), tot('anterior', desdeAbr).padStart(9), tot('c2', desdeAbr).padStart(6), tot('c2niv', desdeAbr).padStart(7));
}

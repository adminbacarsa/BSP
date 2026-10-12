/**
 * Regla c2 de «Continuar desde el mes anterior», sobre el cronograma inicial del mes
 * (sin coberturas ni licencias: el llamador pasa las observaciones ya filtradas).
 *
 * 1. Esqueleto: sin 12 h sueltas ni días de otra banda dentro de un bloque.
 * 2. Plantillas del objetivo de 7, 8, 12 y 24 días, votadas por los guardias que alinean.
 * 3. Fase de cada guardia por sus últimos 14 días; la propuesta sigue esa fase (no reinicia el 1).
 * 4. Poca historia o no alinea: copia al compañero de grupo; un alta hereda la fila de quien sale.
 * 5. Nivelación contra el cupo por franja y día: sugerencias, una persona por bloque, en diagonal.
 */
function diaIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function ymdDeIndex(idx: number): string {
  return new Date(idx * 86400000).toISOString().slice(0, 10);
}

export type CupoDia = { M: number; T: number; N: number };

export type HistoriaC2 = {
  id: string;
  nombre: string;
  /** Un código por día absoluto (F, RET o código de puesto). */
  crudo: Array<{ idx: number; code: string }>;
};

export type NivelacionC2 = {
  dateStr: string;
  de: string;
  a: string;
  /** Banda que se cubre (M, T o N). */
  cubre: 'M' | 'T' | 'N';
  texto: string;
};

export type ViaC2 = 'plantilla' | 'compañero' | 'herencia' | 'rachas';

export type PlanC2 = {
  /** Esqueleto propuesto (sin nivelación): YYYY-MM-DD → código. */
  codes: Record<string, string>;
  periodo: number | null;
  /** fases[i] = código del día con índice absoluto ≡ i (mod período). */
  fases: Array<string | null>;
  ajuste: number;
  grupo: string | null;
  via: ViaC2;
  /** De quién se copió la fila (compañero o saliente). */
  copiaDeId: string | null;
};

export const PERIODOS_PLANTILLA = [7, 8, 12, 24] as const;
const AJUSTE_MIN = 0.8;
const AJUSTE_REF = 0.85;
const DIAS_FASE = 14;

function familia(code: string): string {
  if (code === 'D12') return 'M';
  if (code === 'N12') return 'N';
  return code;
}

function esDescanso(code: string | undefined): boolean {
  return !code || code === 'F' || code === 'RET';
}

function mod(a: number, p: number): number {
  return ((a % p) + p) % p;
}

/** Banda M/T/N de un código de puesto (M2, P1M, P2T… cuentan por su letra), o null. */
export function bandaDe(code: string): 'M' | 'T' | 'N' | null {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (c === 'D12' || /^(?:P\d+|PL)D12$/.test(c)) return 'M';
  if (c === 'N12' || /^(?:P\d+|PL)N12$/.test(c)) return 'N';
  const m = c.match(/^(?:P\d+|PL)?([MTN])\d*$/);
  return m ? (m[1] as 'M' | 'T' | 'N') : null;
}

/** Quita las decoraciones de un mes: cada bloque de trabajo queda con su banda mayoritaria. */
export function esqueletoDelMes(celdas: Map<number, string>): Map<number, string> {
  const base = new Map<number, string>();
  const dias = [...celdas.keys()].sort((a, b) => a - b);
  let i = 0;
  while (i < dias.length) {
    const code = celdas.get(dias[i])!;
    if (esDescanso(code)) {
      base.set(dias[i], code);
      i += 1;
      continue;
    }
    const blk = [dias[i]];
    let j = i + 1;
    while (j < dias.length && dias[j] === dias[j - 1] + 1 && !esDescanso(celdas.get(dias[j]))) {
      blk.push(dias[j]);
      j += 1;
    }
    const porFam = new Map<string, number>();
    const porCode = new Map<string, number>();
    for (const x of blk) {
      const c = celdas.get(x)!;
      porFam.set(familia(c), (porFam.get(familia(c)) || 0) + 1);
      porCode.set(c, (porCode.get(c) || 0) + 1);
    }
    let topFam = '';
    let topN = -1;
    for (const [f, n] of porFam) if (n > topN) { topFam = f; topN = n; }
    const codeBase = [...porCode.keys()]
      .filter((k) => familia(k) === topFam)
      .sort((a, b) => (porCode.get(b) || 0) - (porCode.get(a) || 0))[0];
    let rachaAjena = 0;
    let rachaMax = 0;
    for (const x of blk) {
      rachaAjena = familia(celdas.get(x)!) === topFam ? 0 : rachaAjena + 1;
      rachaMax = Math.max(rachaMax, rachaAjena);
    }
    const decoracion = topN >= blk.length * 0.6 && rachaMax <= 2;
    const aplanar = blk.length > 2 && decoracion;
    for (const x of blk) base.set(x, aplanar ? codeBase : celdas.get(x)!);
    i = j;
  }
  return base;
}

/** Esqueleto por mes calendario (como se armó cada mes). */
export function esqueletoDeHistoria(crudo: Array<{ idx: number; code: string }>): Map<number, string> {
  const porMes = new Map<string, Map<number, string>>();
  for (const c of crudo) {
    const k = ymdDeIndex(c.idx).slice(0, 7);
    const mes = porMes.get(k) || new Map<number, string>();
    mes.set(c.idx, c.code);
    porMes.set(k, mes);
  }
  const out = new Map<number, string>();
  for (const mes of porMes.values()) for (const [i, c] of esqueletoDelMes(mes)) out.set(i, c);
  return out;
}

function autoAcuerdo(obs: Map<number, string>, p: number, last: number): { a: number; t: number } {
  const w = Math.max(2 * p, 21);
  let a = 0;
  let t = 0;
  for (let i = last - w + 1; i <= last; i += 1) {
    if (obs.has(i) && obs.has(i - p)) {
      t += 1;
      if (obs.get(i) === obs.get(i - p)) a += 1;
    }
  }
  return { a: t ? a / t : 0, t };
}

/** Desfase de la plantilla que mejor explica los últimos 14 días con dato. */
export function mejorDesfase(
  obs: Map<number, string>,
  plantilla: Map<number, string>,
  p: number,
  last: number,
): { off: number; ajuste: number; n: number } | null {
  let fin = -Infinity;
  for (const i of obs.keys()) if (i <= last && i > fin) fin = i;
  const recientes = [...obs.keys()].filter((i) => i > fin - 40 && i <= fin).sort((a, b) => a - b).slice(-DIAS_FASE);
  if (recientes.length < 4) return null;
  let bestOff = 0;
  let bestOk = -1;
  for (let off = 0; off < p; off += 1) {
    const ok = recientes.filter((i) => plantilla.get(mod(i + off, p)) === obs.get(i)).length;
    if (ok > bestOk) { bestOk = ok; bestOff = off; }
  }
  return { off: bestOff, ajuste: bestOk / recientes.length, n: recientes.length };
}

/** Período propio (2..28) que mejor repite la familia en la ventana final; el más corto a 2 puntos del mejor. */
function mejorPeriodo(obs: Map<number, string>, last: number): { a: number; p: number } | null {
  const res: Array<{ a: number; p: number }> = [];
  for (let p = 2; p <= 28; p += 1) {
    const w = Math.max(2 * p, 21);
    let a = 0;
    let t = 0;
    for (let i = last - w + 1; i <= last; i += 1) {
      const x = obs.get(i);
      const y = obs.get(i - p);
      if (x == null || y == null) continue;
      t += 1;
      if (familia(x) === familia(y)) a += 1;
    }
    if (t >= Math.max(6, p)) res.push({ a: a / t, p });
  }
  if (!res.length) return null;
  const top = Math.max(...res.map((r) => r.a));
  return res.find((r) => r.a >= top - 0.02) || null;
}

/** Períodos que comparten al menos 2 guardias (además de 7, 8, 12 y 24). */
export function periodosDeConsenso(crudos: Map<string, Map<number, string>>): number[] {
  const votos = new Map<number, number>();
  for (const o of crudos.values()) {
    if (o.size < 14) continue;
    const bp = mejorPeriodo(o, Math.max(...o.keys()));
    if (bp && bp.a >= AJUSTE_MIN) votos.set(bp.p, (votos.get(bp.p) || 0) + 1);
  }
  return [...votos].filter(([, n]) => n >= 2).map(([p]) => p);
}

/** Plantillas del objetivo por período: referencia = el guardia más regular, después voto de los que alinean. */
export function plantillasDelObjetivo(
  esqueletos: Map<string, Map<number, string>>,
  last: number,
  extra: number[] = [],
): Map<number, Map<number, string>> {
  const obs = new Map([...esqueletos].filter(([, o]) => o.size >= 6));
  const out = new Map<number, Map<number, string>>();
  for (const p of [...new Set([...extra, ...PERIODOS_PLANTILLA])].sort((a, b) => a - b)) {
    let ref: { bandas: number; a: number; id: string } | null = null;
    for (const [id, o] of obs) {
      const { a, t } = autoAcuerdo(o, p, last);
      const bandas = new Set([...o].filter(([i, c]) => i > last - p && !esDescanso(c)).map(([, c]) => familia(c))).size;
      if (t >= Math.min(p, 6) && a >= AJUSTE_MIN && (!ref || bandas > ref.bandas || (bandas === ref.bandas && a > ref.a))) {
        ref = { bandas, a, id };
      }
    }
    if (!ref) continue;
    const o = obs.get(ref.id)!;
    const T = new Map<number, string>();
    for (let ph = 0; ph < p; ph += 1) {
      for (let i = last; i > last - 3 * p; i -= 1) {
        if (mod(i, p) === ph && o.has(i)) { T.set(ph, o.get(i)!); break; }
      }
    }
    for (let vuelta = 0; vuelta < 2; vuelta += 1) {
      const votos = new Map<number, Map<string, number>>();
      for (const og of obs.values()) {
        const hit = mejorDesfase(og, T, p, last);
        if (!hit || hit.ajuste < AJUSTE_REF) continue;
        for (const [i, c] of og) {
          if (i <= last - 2 * p || i > last) continue;
          const ph = mod(i + hit.off, p);
          const bag = votos.get(ph) || new Map<string, number>();
          bag.set(c, (bag.get(c) || 0) + 1);
          votos.set(ph, bag);
        }
      }
      for (const [ph, bag] of votos) {
        const top = [...bag.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top) T.set(ph, top[0]);
      }
    }
    const valores = [...T.values()];
    if (valores.includes('F') && valores.some((v) => v !== 'F')) out.set(p, T);
  }
  return out;
}

/**
 * Por período, la plantilla que más guardias explica (≥ 0,85). Se arma con toda la historia y con solo el mes de
 * origen: si el esquema cambió a mitad de mes, las vueltas viejas no tapan el ciclo nuevo.
 */
function elegirPlantillas(
  fuentes: Array<Map<number, Map<number, string>>>,
  obs: Map<string, Map<number, string>>,
  last: number,
): Map<number, Map<number, string>> {
  const out = new Map<number, { T: Map<number, string>; apoyo: number }>();
  for (const fuente of fuentes) {
    for (const [p, T] of fuente) {
      let apoyo = 0;
      for (const o of obs.values()) {
        const hit = mejorDesfase(o, T, p, last);
        if (hit && hit.ajuste >= AJUSTE_REF) apoyo += 1;
      }
      const prev = out.get(p);
      if (!prev || apoyo > prev.apoyo) out.set(p, { T, apoyo });
    }
  }
  return new Map([...out].map(([p, x]) => [p, x.T]));
}

type Esqueleto = {
  codes: Record<string, string>;
  periodo: number | null;
  off: number;
  ajuste: number;
  n: number;
  fases: Array<string | null>;
  via: ViaC2;
};

/** Ciclo propio exacto del guardia (código a código, al menos 3 vueltas): el más corto a 2 puntos del mejor. */
function cicloPropio(obs: Map<number, string>, last: number): { a: number; p: number } | null {
  const fin = Math.max(...[...obs.keys()].filter((i) => i <= last));
  const res: Array<{ a: number; p: number }> = [];
  for (let p = 2; p <= 28; p += 1) {
    let a = 0;
    let t = 0;
    for (let i = fin - Math.max(3 * p, 21) + 1; i <= fin; i += 1) {
      const x = obs.get(i);
      const y = obs.get(i - p);
      if (x == null || y == null) continue;
      t += 1;
      if (x === y) a += 1;
    }
    if (t >= Math.max(14, 2 * p)) res.push({ a: a / t, p });
  }
  if (!res.length) return null;
  const top = Math.max(...res.map((r) => r.a));
  return res.find((r) => r.a >= top - 0.02) || null;
}

function porPlantilla(obs: Map<number, string>, plantillas: Map<number, Map<number, string>>, last: number, dias: string[]): Esqueleto | null {
  if (obs.size < 4) return null;
  const cands: Array<{ ajuste: number; n: number; p: number; off: number; largo: number }> = [];
  for (const [p, T] of plantillas) {
    const hit = mejorDesfase(obs, T, p, last);
    if (!hit) continue;
    const fin = Math.max(...[...obs.keys()].filter((i) => i <= last));
    const ventana = [...obs.keys()].filter((i) => i > fin - 3 * p - 14 && i <= fin).sort((a, b) => a - b).slice(-3 * p);
    const largo = ventana.length ? ventana.filter((i) => T.get(mod(i + hit.off, p)) === obs.get(i)).length / ventana.length : 0;
    cands.push({ ajuste: hit.ajuste, n: hit.n, p, off: hit.off, largo });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.ajuste - a.ajuste || b.n - a.n || b.largo - a.largo || a.p - b.p);
  const win = cands[0];
  if (win.ajuste < AJUSTE_MIN) return null;
  const propio = cicloPropio(obs, last);
  if (propio && propio.p !== win.p && propio.a >= 0.95 && win.largo < propio.a - 0.05) return null;
  const T = plantillas.get(win.p)!;
  const fases = Array.from({ length: win.p }, (_, k) => T.get(mod(k + win.off, win.p)) ?? null);
  const codes: Record<string, string> = {};
  for (const d of dias) {
    const c = fases[mod(diaIndex(d), win.p)];
    if (c) codes[d] = c;
  }
  return { codes, periodo: win.p, off: win.off, ajuste: Math.round(win.ajuste * 100) / 100, n: win.n, fases, via: 'plantilla' };
}

/** Sin plantilla (esquema recién cambiado): largo de bloque, de franco y orden de bandas. */
function porRachas(obs: Map<number, string>, last: number, dias: string[]): Esqueleto | null {
  if (obs.size < 6) return null;
  const runs: Array<{ k: string | null; len: number }> = [];
  for (let i = last - 39; i <= last; i += 1) {
    const c = obs.get(i);
    const k = c == null ? null : (esDescanso(c) ? 'F' : c);
    const prev = runs[runs.length - 1];
    if (prev && prev.k === k) prev.len += 1;
    else runs.push({ k, len: 1 });
  }
  let corte = 0;
  runs.forEach((r, k) => { if (r.k == null && r.len >= 3) corte = k + 1; });
  let rr = runs.slice(corte).filter((r) => r.k != null);
  const es12 = (c: string) => c === 'D12' || c === 'N12';
  const trabajo0 = rr.filter((r) => r.k !== 'F');
  if (trabajo0.length) {
    const cls = es12(trabajo0[trabajo0.length - 1].k!);
    let k0 = 0;
    rr.forEach((r, k) => { if (r.k !== 'F' && es12(r.k!) !== cls) k0 = k + 1; });
    rr = rr.slice(k0);
  }
  const trabajo = rr.filter((r) => r.k !== 'F');
  const francos = rr.filter((r) => r.k === 'F');
  if (trabajo.length < 2 || !francos.length || !rr.length) return null;
  const moda = (xs: number[]) => {
    const bag = new Map<number, number>();
    for (const x of xs.slice(-3)) bag.set(x, (bag.get(x) || 0) + 1);
    return [...bag.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  };
  const compW = trabajo.slice(1, -1).map((r) => r.len);
  const compF = francos.filter((r) => r !== rr[rr.length - 1]).map((r) => r.len);
  const Lw = moda(compW.length ? compW : trabajo.slice(0, -1).map((r) => r.len));
  const Lf = moda(compF.length ? compF : [francos[francos.length - 1].len]);
  if (!Lw || !Lf) return null;
  const orden: string[] = [];
  for (const r of trabajo.slice(-4)) if (!orden.length || orden[orden.length - 1] !== r.k) orden.push(r.k!);
  const ciclo: string[] = [];
  for (const b of [...orden].reverse()) {
    if (ciclo.includes(b)) break;
    ciclo.unshift(b);
  }
  if (!ciclo.length) return null;
  const actual = rr[rr.length - 1];
  let estado = actual.k!;
  let resta = estado === 'F' ? Lf - actual.len : Lw - actual.len;
  let bi = Math.max(0, ciclo.indexOf(trabajo[trabajo.length - 1].k!));
  const fin = diaIndex(dias[dias.length - 1]);
  const porIdx = new Map<number, string>();
  for (let pos = last + 1; pos <= fin; pos += 1) {
    if (resta <= 0) {
      if (estado === 'F') {
        bi = (bi + 1) % ciclo.length;
        estado = ciclo[bi];
        resta = Lw;
      } else {
        estado = 'F';
        resta = Lf;
      }
    }
    porIdx.set(pos, estado);
    resta -= 1;
  }
  const codes: Record<string, string> = {};
  for (const d of dias) {
    const c = porIdx.get(diaIndex(d));
    if (c) codes[d] = c;
  }
  if (!Object.keys(codes).length) return null;
  return { codes, periodo: null, off: 0, ajuste: 0, n: obs.size, fases: [], via: 'rachas' };
}

function cuentaBandas(grid: Map<string, Map<string, string>>, dateStr: string): CupoDia {
  const c: CupoDia = { M: 0, T: 0, N: 0 };
  for (const row of grid.values()) {
    const code = row.get(dateStr);
    if (!code || esDescanso(code)) continue;
    if (code === 'D12') { c.M += 1; c.T += 0.5; continue; }
    if (code === 'N12') { c.N += 1; c.T += 0.5; continue; }
    const b = bandaDe(code);
    if (b) c[b] += 1;
  }
  return c;
}

function haciaBanda(code: string, banda: 'M' | 'T'): string {
  const c = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^((?:P\d+|PL)?)([MTN])(\d*)$/);
  return m ? `${m[1]}${banda}${m[3]}` : banda;
}

function apellido(nombre: string): string {
  return String(nombre || '').split(',')[0].trim();
}

/**
 * Nivelación día por día: sobra N y falta T → uno de N pasa a T; sobra T y falta M → T→M;
 * sobra N y falta M → N→T y T→M. Quién: el primero en el orden de filas que todavía no tuvo
 * cambio en ese bloque (el puntero sigue desde el mes anterior). No toca a los fijos.
 */
export function nivelarContraCupo(args: {
  grid: Map<string, Map<string, string>>;
  orden: string[];
  dias: string[];
  nombres: Map<string, string>;
  fijos: Set<string>;
  cupo: (dateStr: string) => CupoDia | null;
  punteroPrevio: string[];
  /** `${id}|${dateStr}` que cuentan para el cupo pero no se mueven (ya cargadas en el mes). */
  bloqueadas?: Set<string>;
}): Map<string, NivelacionC2[]> {
  const G = new Map<string, Map<string, string>>();
  for (const [id, row] of args.grid) G.set(id, new Map(row));
  const conCambio = new Map<string, Set<string>>();
  if (args.dias.length) for (const id of args.punteroPrevio) conCambio.set(id, new Set([args.dias[0]]));
  const inicioBloque = (id: string, k: number) => {
    const row = G.get(id)!;
    let i = k;
    while (i - 1 >= 0 && !esDescanso(row.get(args.dias[i - 1]))) i -= 1;
    return args.dias[i];
  };
  const cambios = new Map<string, NivelacionC2[]>();
  args.dias.forEach((dateStr, k) => {
    const cup = args.cupo(dateStr);
    if (!cup) return;
    const usados = new Set<string>();
    for (let it = 0; it < 8; it += 1) {
      const hay = cuentaBandas(G, dateStr);
      const dM = hay.M - cup.M;
      const dT = hay.T - cup.T;
      const dN = hay.N - cup.N;
      let pasos: Array<['N' | 'T', 'T' | 'M']> | null = null;
      if (dN >= 1 && dT <= -1) pasos = [['N', 'T']];
      else if (dT >= 1 && dM <= -1) pasos = [['T', 'M']];
      else if (dN >= 1 && dM <= -1) pasos = [['N', 'T'], ['T', 'M']];
      if (!pasos) break;
      let ok = true;
      for (const [de, a] of pasos) {
        const cands: Array<{ fijo: number; ya: number; ord: number; id: string; bloque: string; code: string }> = [];
        args.orden.forEach((id, ord) => {
          if (usados.has(id) || args.bloqueadas?.has(`${id}|${dateStr}`)) return;
          const code = G.get(id)?.get(dateStr);
          if (!code || code === 'D12' || code === 'N12' || bandaDe(code) !== de) return;
          const bloque = inicioBloque(id, k);
          cands.push({ fijo: args.fijos.has(id) ? 1 : 0, ya: conCambio.get(id)?.has(bloque) ? 1 : 0, ord, id, bloque, code });
        });
        cands.sort((x, y) => x.fijo - y.fijo || x.ya - y.ya || x.ord - y.ord);
        const elegido = cands[0];
        if (!elegido) { ok = false; break; }
        const nuevo = haciaBanda(elegido.code, a);
        G.get(elegido.id)!.set(dateStr, nuevo);
        usados.add(elegido.id);
        const set = conCambio.get(elegido.id) || new Set<string>();
        set.add(elegido.bloque);
        conCambio.set(elegido.id, set);
        const list = cambios.get(elegido.id) || [];
        list.push({
          dateStr,
          de: elegido.code,
          a: nuevo,
          cubre: a,
          texto: `${dateStr.slice(8)}/${dateStr.slice(5, 7)}: ${apellido(args.nombres.get(elegido.id) || elegido.id)} ${elegido.code}→${nuevo} para cubrir ${a}`,
        });
        cambios.set(elegido.id, list);
      }
      if (!ok) break;
    }
  });
  return cambios;
}

/** Ids cuyo último bloque de trabajo del mes trae un cambio de nivelación aceptado: el puntero sigue desde ahí. */
export function punteroAlCierre(
  planes: Array<{ id: string; codes: Record<string, string>; aceptadas: NivelacionC2[] }>,
  dias: string[],
): string[] {
  const out: string[] = [];
  for (const p of planes) {
    let i = dias.length - 1;
    while (i >= 0 && esDescanso(p.codes[dias[i]])) i -= 1;
    if (i < 0) continue;
    let j = i;
    while (j - 1 >= 0 && !esDescanso(p.codes[dias[j - 1]])) j -= 1;
    if (p.aceptadas.some((n) => n.dateStr >= dias[j] && n.dateStr <= dias[i])) out.push(p.id);
  }
  return out;
}

/** Puntero derivado del mes anterior: quien cerró con un día de otra banda en su último bloque (y arranca trabajando). */
function punteroDerivado(crudo: Map<number, string>, base: Map<number, string>, last: number): boolean {
  let d = last;
  while (crudo.has(d) && !esDescanso(crudo.get(d))) {
    if (crudo.get(d) !== base.get(d)) return true;
    d -= 1;
  }
  return false;
}

/** Último día con dato del objetivo (≤ last): si el mes anterior quedó sin cargar, las ventanas miran desde ahí. */
function ultimoDato(obs: Map<string, Map<number, string>>, last: number): number {
  let max = -Infinity;
  for (const o of obs.values()) for (const i of o.keys()) if (i <= last && i > max) max = i;
  return Number.isFinite(max) ? max : last;
}

export function continuarC2(args: {
  historias: HistoriaC2[];
  /** Orden de filas de la grilla (los del mes nuevo). */
  orden: string[];
  /** Con historia y fuera de la dotación nueva: un alta hereda su fila. */
  salientes?: string[];
  dias: string[];
}): Map<string, PlanC2> {
  const out = new Map<string, PlanC2>();
  if (!args.dias.length) return out;
  const last = diaIndex(args.dias[0]) - 1;
  const nombres = new Map(args.historias.map((h) => [h.id, h.nombre]));
  const crudos = new Map(args.historias.map((h) => [h.id, new Map(h.crudo.map((c) => [c.idx, c.code]))]));
  const bases = new Map(args.historias.map((h) => [h.id, esqueletoDeHistoria(h.crudo.filter((c) => c.idx <= last))]));
  const enRango = new Map([...crudos].map(([id, o]) => [id, new Map([...o].filter(([i]) => i <= last))]));
  const consenso = periodosDeConsenso(enRango);
  const ref = ultimoDato(bases, last);
  const mesOrigen = ymdDeIndex(ref).slice(0, 7);
  const basesMes = new Map([...bases].map(([id, o]) => [id, new Map([...o].filter(([i]) => ymdDeIndex(i).startsWith(mesOrigen)))]));
  const plantillas = elegirPlantillas(
    [plantillasDelObjetivo(bases, ref, consenso), plantillasDelObjetivo(basesMes, ref, consenso)],
    bases,
    ref,
  );
  const esq = new Map<string, Esqueleto>();
  for (const [id, o] of bases) {
    const p = porPlantilla(o, plantillas, last, args.dias);
    if (p) esq.set(id, p);
    else if (!plantillas.size) {
      const r = porRachas(o, last, args.dias);
      if (r) esq.set(id, r);
    }
  }
  const copias = new Map<string, string>();
  const recientes = (id: string) => [...(bases.get(id) || new Map()).keys()].filter((i) => i > ref - 21 && i <= ref).sort((a, b) => a - b).slice(-DIAS_FASE);
  for (const id of args.orden) {
    const o = bases.get(id) || new Map<number, string>();
    const e = esq.get(id);
    const debil = !e || e.via !== 'plantilla' || e.n < 10;
    const rec = recientes(id);
    if (!debil || rec.length < 4) continue;
    const cp = o.size ? cicloPropio(o, last) : null;
    if (!e && cp && cp.a >= 0.95) continue;
    let best: { ag: number; rota: number; n: number; id: string } | null = null;
    for (const [h, eh] of esq) {
      if (h === id || eh.via !== 'plantilla' || eh.ajuste < AJUSTE_REF || eh.n < 10) continue;
      const oh = bases.get(h)!;
      const ambos = rec.filter((i) => oh.has(i));
      if (ambos.length < 4) continue;
      const ag = ambos.filter((i) => oh.get(i) === o.get(i)).length / ambos.length;
      const rota = new Set([...oh.values()].filter((c) => !esDescanso(c)).map(familia)).size > 1 ? 1 : 0;
      if (ag >= AJUSTE_REF && (!best || ag > best.ag || (ag === best.ag && (rota > best.rota || (rota === best.rota && ambos.length > best.n))))) {
        best = { ag, rota, n: ambos.length, id: h };
      }
    }
    if (!best) continue;
    const src = esq.get(best.id)!;
    esq.set(id, { ...src, codes: { ...src.codes }, via: 'compañero' });
    copias.set(id, best.id);
  }
  const salientes = (args.salientes || []).filter((s) => !args.orden.includes(s) && esq.get(s)?.periodo != null);
  const altas = args.orden.filter((id) => !esq.has(id) && (bases.get(id)?.size || 0) < 4);
  const usados = new Set<string>();
  for (const id of altas) {
    const libres = salientes.filter((s) => !usados.has(s));
    if (!libres.length) break;
    const k = args.orden.indexOf(id);
    const vecinos = [args.orden[k - 1], args.orden[k + 1]].filter(Boolean).map((v) => esq.get(v)).filter((e): e is Esqueleto => !!e && e.periodo != null);
    const fasesVecinas = new Set(vecinos.map((e) => `${e.periodo}:${e.off}`));
    const porFase = libres.filter((s) => fasesVecinas.has(`${esq.get(s)!.periodo}:${esq.get(s)!.off}`));
    const uno = porFase.length === 1 ? porFase[0] : (altas.length === 1 && libres.length === 1 ? libres[0] : '');
    if (!uno) continue;
    const src = esq.get(uno)!;
    esq.set(id, { ...src, codes: { ...src.codes }, via: 'herencia' });
    copias.set(id, uno);
    usados.add(uno);
  }
  const miembros = new Map<string, number>();
  for (const id of args.orden) {
    const e = esq.get(id);
    if (!e || e.periodo == null) continue;
    const key = `${e.periodo}:${e.off}`;
    miembros.set(key, (miembros.get(key) || 0) + 1);
  }
  const grupos = new Map<string, string>();
  for (const id of args.orden) {
    const e = esq.get(id);
    if (!e || e.periodo == null) continue;
    const key = `${e.periodo}:${e.off}`;
    if ((miembros.get(key) || 0) < 2 || grupos.has(key)) continue;
    grupos.set(key, String.fromCharCode(65 + (grupos.size % 26)));
  }
  for (const id of args.orden) {
    const e = esq.get(id);
    if (!e) continue;
    out.set(id, {
      codes: e.codes,
      periodo: e.periodo,
      fases: e.fases,
      ajuste: e.ajuste,
      grupo: e.periodo != null ? grupos.get(`${e.periodo}:${e.off}`) || null : null,
      via: e.via,
      copiaDeId: copias.get(id) || null,
    });
  }
  return out;
}

/**
 * Para la nivelación: quién es de banda fija (14+ días de una sola banda: se mueve último) y quién cerró
 * el mes anterior con un día de otra banda en su último bloque (el puntero sigue desde ahí).
 */
export function rasgosDeHistoria(historias: HistoriaC2[], dias: string[]): { fijos: Set<string>; cierraConCambio: Set<string> } {
  const fijos = new Set<string>();
  const cierraConCambio = new Set<string>();
  if (!dias.length) return { fijos, cierraConCambio };
  const last = diaIndex(dias[0]) - 1;
  const mesOrigen = ymdDeIndex(ultimoDato(new Map(historias.map((h) => [h.id, new Map(h.crudo.map((c) => [c.idx, c.code]))])), last)).slice(0, 7);
  for (const h of historias) {
    const crudo = new Map(h.crudo.filter((c) => c.idx <= last).map((c) => [c.idx, c.code]));
    const base = esqueletoDeHistoria(h.crudo.filter((c) => c.idx <= last));
    const delMes = [...base].filter(([i]) => ymdDeIndex(i).startsWith(mesOrigen)).map(([, c]) => c);
    if (delMes.length >= 14 && new Set(delMes.filter((c) => !esDescanso(c)).map(familia)).size <= 1) fijos.add(h.id);
    if (punteroDerivado(crudo, base, last)) cierraConCambio.add(h.id);
  }
  return { fijos, cierraConCambio };
}

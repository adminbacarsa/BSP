/**
 * Refuerzos desde el modo rápido.
 * RFZF (fijo): cambio permanente del servicio desde una fecha (puesto/turno con su sigla y patrón).
 * RFZE (eventual): fechas puntuales con sigla propia, fuera del servicio, con pedido de refuerzo aprobado.
 */

export type DiaLetra = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';
export const DIAS_SEMANA: DiaLetra[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LETRA_UTC: DiaLetra[] = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export const PUESTO_RFZF = 'RFZF';

export function letraDeFecha(ds: string): DiaLetra {
  const [y, m, d] = ds.split('-').map(Number);
  return LETRA_UTC[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Fechas del mes desde `desde` (incluida) hasta fin de mes cuyo día de la semana está en `dias`. */
export function fechasRfzf(desde: string, dias: readonly DiaLetra[]): string[] {
  const [y, m, d0] = desde.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = d0; d <= ultimo; d++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dias.includes(letraDeFecha(ds))) out.push(ds);
  }
  return out;
}

function horas(inicio: string, fin: string): number {
  const [h1, m1] = inicio.split(':').map(Number);
  const [h2, m2] = fin.split(':').map(Number);
  if ([h1, m1, h2, m2].some((v) => Number.isNaN(v))) return 0;
  let min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min <= 0) min += 1440;
  return Math.round((min / 60) * 100) / 100;
}

type ShiftDoc = { code?: string; name?: string; startTime?: string; endTime?: string; hours?: number; quantity?: number; days?: string[]; [k: string]: unknown };
type PosDoc = { id?: string; name?: string; positionName?: string; allowedShiftTypes?: ShiftDoc[]; shifts?: ShiftDoc[]; [k: string]: unknown };

/** Marca del refuerzo fijo en la franja: arranca en `desde` y sigue con el patrón `dias`. */
export type MarcaRefuerzoFijo = { tipo: 'FIJO'; desde: string; dias: DiaLetra[] };

/**
 * Refuerzo fijo = cambio permanente del servicio desde una fecha: un turno (franja) nuevo en un puesto
 * nuevo o existente (Casino: puesto PP, T 15–22 y N 22–05 desde el 10/10). En el mes de inicio corre
 * desde esa fecha (fechas concretas); desde el mes siguiente es servicio normal con su patrón.
 * Misma sigla y mismo horario en el puesto: +pax. Sin sigla: RFZF, RFZF2…
 */
export function agregarRfzfAPosiciones(
  positions: readonly PosDoc[],
  r: { inicio: string; fin: string; dias: readonly DiaLetra[]; pax: number; puesto?: string; sigla?: string; desde?: string },
): { positions: PosDoc[]; code: string; puesto: string; texto: string } {
  const out: PosDoc[] = positions.map((p) => ({ ...p, allowedShiftTypes: [...(p.allowedShiftTypes || [])], ...(p.shifts ? { shifts: [...p.shifts] } : {}) }));
  const nombrePuesto = (r.puesto || '').trim() || PUESTO_RFZF;
  let pos = out.find((p) => String(p.name || p.positionName || '').trim().toUpperCase() === nombrePuesto.toUpperCase());
  if (!pos) {
    pos = { id: `rfzf_${Date.now()}`, name: nombrePuesto, coverageType: 'custom', quantity: 1, activeDays: [...DIAS_SEMANA], allowedShiftTypes: [], status: 'ACTIVE' };
    out.push(pos);
  }
  const lista = pos.allowedShiftTypes || [];
  const pax = Math.max(1, Math.round(r.pax) || 1);
  const dias = DIAS_SEMANA.filter((d) => r.dias.includes(d));
  const sigla = (r.sigla || '').trim().toUpperCase().replace(/\s+/g, '');
  const desde = (r.desde || '').slice(0, 10);
  // Arranca a mitad de mes: ese mes corre solo desde `desde` (fechas concretas); el patrón queda en la marca.
  const arrancaEnElMes = !!desde && Number(desde.slice(8, 10)) > 1;
  const fechas = arrancaEnElMes ? fechasRfzf(desde, dias) : [];
  const marca: MarcaRefuerzoFijo | null = desde ? { tipo: 'FIJO', desde, dias } : null;
  const igual = lista.findIndex((s) => (sigla ? String(s.code || '').toUpperCase() === sigla : String(s.code || '').toUpperCase().startsWith(PUESTO_RFZF))
    && s.startTime === r.inicio && s.endTime === r.fin);
  if (igual >= 0) {
    const s0 = lista[igual];
    const union = DIAS_SEMANA.filter((d) => dias.includes(d) || (s0.days || []).includes(d));
    const nuevo = { ...s0, quantity: (Number(s0.quantity) || 1) + pax, days: union };
    pos.allowedShiftTypes = lista.map((x, i) => (i === igual ? nuevo : x));
    if (pos.shifts) pos.shifts = pos.shifts.map((x) => (x.code === s0.code ? nuevo : x));
    return { positions: out, code: String(s0.code), puesto: String(pos.name || nombrePuesto), texto: `${s0.code} ${r.inicio}–${r.fin}: ×${nuevo.quantity} pax` };
  }
  const usados = new Set(lista.map((x) => String(x.code || '').toUpperCase()));
  let code = sigla;
  if (!code || usados.has(code)) {
    const base = code || PUESTO_RFZF;
    let n = code ? 2 : 1;
    code = code ? `${base}${n}` : base;
    while (usados.has(code)) { n += 1; code = `${base}${n}`; }
  }
  const turno: ShiftDoc = {
    code,
    name: sigla ? code : 'Refuerzo fijo',
    startTime: r.inicio,
    endTime: r.fin,
    hours: horas(r.inicio, r.fin),
    quantity: pax,
    ...(fechas.length ? { specificDates: fechas } : dias.length < 7 ? { days: dias } : {}),
    ...(marca ? { refuerzoFijo: marca } : {}),
  };
  pos.allowedShiftTypes = [...lista, turno];
  if (pos.shifts) pos.shifts = [...pos.shifts, turno];
  const patron = dias.length === 7 ? 'todos los días' : dias.join(' ');
  return {
    positions: out,
    code,
    puesto: String(pos.name || nombrePuesto),
    texto: `${pos.name} · ${code} ${r.inicio}–${r.fin} ×${pax} · ${patron}${desde ? ` desde ${desde.slice(8, 10)}/${desde.slice(5, 7)}` : ''}`,
  };
}

/**
 * Al pasar el servicio al mes siguiente: el refuerzo fijo queda con su patrón (sin fechas); una franja con
 * fechas del mes anterior sin marca (cargada antes de esto) que corría hasta fin de mes todos los días
 * también pasa a todos los días; las demás fechas que no son del mes nuevo se sacan.
 */
export function franjasParaMesSiguiente<P extends PosDoc>(positions: readonly P[], mesNuevo: string): P[] {
  const ajustar = (s: ShiftDoc): ShiftDoc | null => {
    const marca = s.refuerzoFijo as MarcaRefuerzoFijo | undefined;
    const fechas = Array.isArray(s.specificDates) ? (s.specificDates as string[]) : [];
    // En su mes de inicio el refuerzo fijo conserva las fechas desde que arranca.
    if (marca?.tipo === 'FIJO' && String(marca.desde || '').slice(0, 7) >= mesNuevo) {
      const delMes = fechas.filter((f) => f.startsWith(mesNuevo));
      return fechas.length && !delMes.length ? null : (fechas.length ? { ...s, specificDates: delMes } : s);
    }
    if (marca?.tipo === 'FIJO') {
      const { specificDates: _sd, refuerzoFijo: _m, ...resto } = s as ShiftDoc & { specificDates?: unknown };
      const dias = DIAS_SEMANA.filter((d) => (marca.dias || []).includes(d));
      const base: ShiftDoc = { ...resto };
      delete (base as { days?: unknown }).days;
      return dias.length && dias.length < 7 ? { ...base, days: dias } : base;
    }
    if (!fechas.length) return s;
    const delMes = fechas.filter((f) => f.startsWith(mesNuevo));
    if (delMes.length) return { ...s, specificDates: delMes };
    const orden = [...fechas].sort();
    const ultima = orden[orden.length - 1];
    const [y, m] = ultima.split('-').map(Number);
    const finMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const seguidas = orden.every((f, i) => i === 0 || Number(f.slice(8, 10)) === Number(orden[i - 1].slice(8, 10)) + 1);
    if (Number(ultima.slice(8, 10)) === finMes && seguidas) {
      const { specificDates: _sd, ...resto } = s as ShiftDoc & { specificDates?: unknown };
      return resto;
    }
    return null;
  };
  const out: P[] = [];
  for (const p of positions) {
    const lista = (p.allowedShiftTypes || []).map(ajustar).filter((x): x is ShiftDoc => !!x);
    const shifts = p.shifts ? p.shifts.map(ajustar).filter((x): x is ShiftDoc => !!x) : undefined;
    if ((p.allowedShiftTypes || []).length && !lista.length) continue;
    out.push({ ...p, allowedShiftTypes: lista, ...(shifts ? { shifts } : {}) });
  }
  return out;
}

/** «1/11, 3/11» o «28/10-5/11»: fechas ISO a partir del año del mes que se ve. */
export function fechasDeTexto(texto: string, year: number): string[] {
  const out = new Set<string>();
  const iso = (d: number, m: number, y: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  for (const parte of String(texto || '').split(/[,;\s]+/).filter(Boolean)) {
    const rango = parte.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (rango) {
      const y1 = rango[3] ? Number(rango[3].length === 2 ? `20${rango[3]}` : rango[3]) : year;
      const y2 = rango[6] ? Number(rango[6].length === 2 ? `20${rango[6]}` : rango[6]) : (Number(rango[5]) < Number(rango[2]) ? year + 1 : year);
      const a = new Date(Date.UTC(y1, Number(rango[2]) - 1, Number(rango[1])));
      const b = new Date(Date.UTC(y2, Number(rango[5]) - 1, Number(rango[4])));
      for (let t = a.getTime(), i = 0; t <= b.getTime() && i < 62; t += 86400000, i += 1) {
        const d = new Date(t);
        out.add(iso(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear()));
      }
      continue;
    }
    const una = parte.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (una) {
      const y = una[3] ? Number(una[3].length === 2 ? `20${una[3]}` : una[3]) : year;
      out.add(iso(Number(una[1]), Number(una[2]), y));
    }
  }
  return [...out].sort();
}

export function horarioValido(hm: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(hm.trim());
}

/** «6» → 06:00, «630» → 06:30, «6:3» → 06:30. */
export function normalizarHora(v: string): string {
  const t = v.trim().replace('.', ':');
  if (/^\d{1,2}$/.test(t)) return `${t.padStart(2, '0')}:00`;
  if (/^\d{3,4}$/.test(t)) { const s = t.padStart(4, '0'); return `${s.slice(0, 2)}:${s.slice(2)}`; }
  const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2].padEnd(2, '0').slice(0, 2)}`;
  return t;
}

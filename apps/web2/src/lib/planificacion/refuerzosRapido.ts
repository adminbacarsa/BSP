/**
 * Refuerzos desde el modo rápido.
 * RFZF (fijo): franja del puesto «RFZF» del servicio del mes; un refuerzo por horario
 * (mismo horario y otra persona = ×2 pax; otro horario = otra franja RFZF2, RFZF3…).
 * RFZE (eventual): fechas puntuales, fuera del servicio, con pedido de refuerzo aprobado.
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

/**
 * Suma un refuerzo fijo al puesto RFZF. Mismo horario: +pax y une los días. Otro horario: franja nueva.
 * Devuelve el código de la franja (RFZF, RFZF2…) para escribir los turnos.
 */
export function agregarRfzfAPosiciones(
  positions: readonly PosDoc[],
  r: { inicio: string; fin: string; dias: readonly DiaLetra[]; pax: number },
): { positions: PosDoc[]; code: string; texto: string } {
  const out: PosDoc[] = positions.map((p) => ({ ...p, allowedShiftTypes: [...(p.allowedShiftTypes || [])], ...(p.shifts ? { shifts: [...p.shifts] } : {}) }));
  let pos = out.find((p) => String(p.name || p.positionName || '').trim().toUpperCase() === PUESTO_RFZF);
  if (!pos) {
    pos = { id: `rfzf_${Date.now()}`, name: PUESTO_RFZF, coverageType: 'custom', quantity: 1, activeDays: [...DIAS_SEMANA], allowedShiftTypes: [], status: 'ACTIVE' };
    out.push(pos);
  }
  const lista = pos.allowedShiftTypes || [];
  const pax = Math.max(1, Math.round(r.pax) || 1);
  const dias = DIAS_SEMANA.filter((d) => r.dias.includes(d));
  const igual = lista.findIndex((s) => String(s.code || '').toUpperCase().startsWith(PUESTO_RFZF) && s.startTime === r.inicio && s.endTime === r.fin);
  if (igual >= 0) {
    const s = lista[igual];
    const union = DIAS_SEMANA.filter((d) => dias.includes(d) || (s.days || []).includes(d));
    const nuevo = { ...s, quantity: (Number(s.quantity) || 1) + pax, days: union };
    pos.allowedShiftTypes = lista.map((x, i) => (i === igual ? nuevo : x));
    if (pos.shifts) pos.shifts = pos.shifts.map((x) => (x.code === s.code ? nuevo : x));
    return { positions: out, code: String(s.code), texto: `RFZF ${r.inicio}–${r.fin}: ×${nuevo.quantity} pax` };
  }
  const usados = new Set(lista.map((s) => String(s.code || '').toUpperCase()));
  let n = 1;
  let code = PUESTO_RFZF;
  while (usados.has(code)) { n += 1; code = `${PUESTO_RFZF}${n}`; }
  const turno: ShiftDoc = { code, name: 'Refuerzo fijo', startTime: r.inicio, endTime: r.fin, hours: horas(r.inicio, r.fin), quantity: pax, ...(dias.length < 7 ? { days: dias } : {}) };
  pos.allowedShiftTypes = [...lista, turno];
  if (pos.shifts) pos.shifts = [...pos.shifts, turno];
  return { positions: out, code, texto: `Nueva franja ${code} ${r.inicio}–${r.fin} ×${pax} · ${dias.length === 7 ? 'todos los días' : dias.join(' ')}` };
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

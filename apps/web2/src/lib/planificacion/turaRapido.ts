/**
 * Turno agregado (TURA) desde el modo rápido. En un puesto que no es de 24 h el `+`
 * no pasa a D12/N12: agrega de 1 a 8 h pegadas al turno, antes (entra antes) o
 * después (sale después). Se escribe como un turno TURA atado al turno (`parentShiftId`).
 */

export type LadoTura = 'antes' | 'despues';

export type TuraPendiente = { lado: LadoTura; horas: number };

export const HORAS_TURA = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Jornada máxima con lo agregado (tope 12:59 del CCT). */
const TOPE_JORNADA_MIN = 12 * 60 + 59;

type ShiftLike = { code?: string; startTime?: string; endTime?: string };
type PuestoLike = { coverageType?: string; shifts?: ShiftLike[] } | null | undefined;

function aMin(hm: string): number | null {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function aHm(min: number): string {
  const v = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** D12/N12 solo en un puesto de 24 HS o cuyas franjas cubren el día. Sin servicio, como siempre. */
export function puestoAdmite12h(pos: PuestoLike): boolean {
  if (!pos) return true;
  if (String(pos.coverageType || '').toLowerCase() === '24hs') return true;
  const cubierto = new Array<boolean>(1440).fill(false);
  for (const s of pos.shifts || []) {
    const ini = aMin(String(s.startTime || ''));
    let fin = aMin(String(s.endTime || ''));
    if (ini == null || fin == null) continue;
    if (fin <= ini) fin += 1440;
    for (let m = ini; m < fin; m++) cubierto[m % 1440] = true;
  }
  return cubierto.every(Boolean);
}

/** Tramo del agregado: antes = [inicio − h, inicio); después = [fin, fin + h). */
export function tramoTura(inicio: string, fin: string, t: TuraPendiente): { startTime: string; endTime: string } | null {
  const a = aMin(inicio);
  const b = aMin(fin);
  if (a == null || b == null || t.horas < 1 || t.horas > 8) return null;
  const h = Math.round(t.horas) * 60;
  return t.lado === 'antes'
    ? { startTime: aHm(a - h), endTime: aHm(a) }
    : { startTime: aHm(b), endTime: aHm(b + h) };
}

/** Aviso si turno + agregado pasa el tope de jornada. No bloquea: se autoriza al publicar. */
export function avisoJornadaTura(inicio: string, fin: string, horas: number): string {
  const a = aMin(inicio);
  let b = aMin(fin);
  if (a == null || b == null) return '';
  if (b <= a) b += 1440;
  const total = (b - a) + horas * 60;
  if (total <= TOPE_JORNADA_MIN) return '';
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `La jornada queda en ${hh} h${mm ? ` ${mm} min` : ''}: pasa el tope de 12:59.`;
}

export function textoTura(code: string, inicio: string, fin: string, t: TuraPendiente): string {
  const tramo = tramoTura(inicio, fin, t);
  if (!tramo) return '';
  return `TURA ${tramo.startTime}–${tramo.endTime} (${t.horas} h, ${t.lado === 'antes' ? 'antes' : 'después'} del ${code})`;
}

export function marcaTura(t: TuraPendiente): string {
  return t.lado === 'antes' ? `+${t.horas}h◂` : `+${t.horas}h▸`;
}

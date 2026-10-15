/**
 * «Continuar» ofrece activar el mes del servicio cuando el contrato no cubre el mes nuevo.
 * La escritura es la de «Agregar meses» (`appendMonthsClient`).
 */
import { nombreMes } from '@/lib/planificacion/padronAlta';

export type SlaParaActivar = {
  id: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  status?: string;
};

export type DecisionActivarServicio = {
  mostrar: boolean;
  /** Tildado al abrir: el último servicio es el del mes anterior y no está cerrado. */
  marcado: boolean;
  puede: boolean;
  motivo: string;
  mes: string;
  lastId: string | null;
  /** Último día del mes que se está planificando. */
  newEndDate: string;
};

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function ultimoDia(y: number, m: number): string {
  return ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}

function mesPrevio(y: number, m: number): { y: number; m: number; key: string } {
  const dt = new Date(Date.UTC(y, m - 2, 1));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, key: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}` };
}

function dia(v: unknown): string {
  return String(v || '').slice(0, 10);
}

function abierto(s: SlaParaActivar): boolean {
  return String(s.status || 'active').toUpperCase() !== 'INACTIVE';
}

/**
 * El mes no está cubierto hasta el último día, o no hay servicio.
 * Se puede activar solo si el último servicio termina en el mes anterior o dentro del mes
 * (y no está cerrado, y el cliente sigue activo). Un hueco de más de un mes se pide desde Servicios.
 */
export function decidirActivarServicio(input: {
  slas: SlaParaActivar[];
  year: number;
  month: number;
  clienteActivo: boolean;
}): DecisionActivarServicio {
  const mes = nombreMes(input.month - 1);
  const desde = ymd(input.year, input.month, 1);
  const hasta = ultimoDia(input.year, input.month);
  const base: DecisionActivarServicio = { mostrar: false, marcado: false, puede: false, motivo: '', mes, lastId: null, newEndDate: hasta };
  const pool = input.slas.filter(abierto);
  const cubre = pool.some((s) => !s.closed && dia(s.startDate) <= desde && dia(s.endDate) >= hasta);
  if (cubre) return base;
  // El de base es el último que arranca antes del mes y termina antes de su fin. Un servicio posterior
  // (diciembre cargado con noviembre vacío) no cuenta: si no, se pedía «agregá los meses desde Servicios».
  const porFin = (a: SlaParaActivar, b: SlaParaActivar) => dia(b.endDate).localeCompare(dia(a.endDate));
  const conFin = pool.filter((s) => dia(s.endDate));
  const last = conFin.filter((s) => dia(s.startDate) <= hasta && dia(s.endDate) < hasta).sort(porFin)[0] || conFin.sort(porFin)[0];
  if (!last) {
    return { ...base, mostrar: true, motivo: 'Este objetivo no tiene servicio. Crearlo desde Servicios.' };
  }
  const fin = dia(last.endDate);
  const prev = mesPrevio(input.year, input.month);
  const mesFin = fin.slice(0, 7);
  const mesVista = hasta.slice(0, 7);
  const esElAnterior = mesFin === prev.key;
  const terminaDentro = mesFin === mesVista && fin < hasta;
  const mostrar = true;
  if (!esElAnterior && !terminaDentro) {
    return { ...base, mostrar, lastId: last.id, motivo: `El último servicio termina el ${fin.slice(8, 10)}/${fin.slice(5, 7)}/${fin.slice(0, 4)}. Agregá los meses desde Servicios.` };
  }
  if (last.closed) {
    return { ...base, mostrar, lastId: last.id, motivo: 'El último servicio está cerrado. Reabrilo para agregar el mes.' };
  }
  if (!input.clienteActivo) {
    return { ...base, mostrar, lastId: last.id, motivo: 'El cliente está inactivo.' };
  }
  return { ...base, mostrar, puede: true, marcado: esElAnterior, lastId: last.id };
}

type FranjaCmp = { code?: string; name?: string; startTime?: string; endTime?: string; quantity?: number | null; days?: string[] | null };
type PuestoCmp = { name?: string; positionName?: string; quantity?: number | null; allowedShiftTypes?: FranjaCmp[] };

export type SlaConPuestos = SlaParaActivar & { positions?: PuestoCmp[]; exigeCobertura?: boolean | null };

export type DecisionActualizarServicio =
  | { accion: 'nada' }
  | { accion: 'no_se_puede'; mes: string; motivo: string }
  | { accion: 'actualizar'; mes: string; mesBase: string; baseId: string; targetId: string; cambios: string[] };

const nombrePuesto = (p: PuestoCmp) => String(p.name || p.positionName || '').trim();
const normP = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const textoDias = (d?: string[] | null) => (d && d.length && d.length < 7 ? ` (${d.join('')})` : '');

function franjasDe(p: PuestoCmp): Map<string, FranjaCmp> {
  const m = new Map<string, FranjaCmp>();
  for (const f of p.allowedShiftTypes || []) m.set(normP(String(f.code || f.name || '')), f);
  return m;
}

/** Diferencias de estructura (puestos, franjas, horario, cantidad, días) entre el servicio base y el del mes. */
export function cambiosDeServicio(base: PuestoCmp[], destino: PuestoCmp[]): string[] {
  const out: string[] = [];
  const dest = new Map(destino.map((p) => [normP(nombrePuesto(p)), p]));
  const bas = new Map(base.map((p) => [normP(nombrePuesto(p)), p]));
  for (const [k, p] of dest) if (!bas.has(k)) out.push(`${nombrePuesto(p)}: se quita`);
  for (const [k, b] of bas) {
    const d = dest.get(k);
    const nom = nombrePuesto(b);
    if (!d) { out.push(`${nom}: se agrega`); continue; }
    const qb = Number(b.quantity ?? 1);
    const qd = Number(d.quantity ?? 1);
    if (qb !== qd) out.push(`${nom}: cantidad ${qd} → ${qb}`);
    const fb = franjasDe(b);
    const fd = franjasDe(d);
    for (const [c, f] of fd) if (!fb.has(c)) out.push(`${nom} · ${f.code || f.name}: se quita`);
    for (const [c, f] of fb) {
      const g = fd.get(c);
      const cod = f.code || f.name;
      if (!g) { out.push(`${nom} · ${cod}: se agrega ${f.startTime}–${f.endTime}`); continue; }
      if (g.startTime !== f.startTime || g.endTime !== f.endTime) out.push(`${nom} · ${cod}: ${g.startTime}–${g.endTime} → ${f.startTime}–${f.endTime}`);
      const q1 = g.quantity ?? qd;
      const q2 = f.quantity ?? qb;
      if (Number(q1) !== Number(q2)) out.push(`${nom} · ${cod}: ${q1} → ${q2} por banda`);
      if (textoDias(g.days) !== textoDias(f.days)) out.push(`${nom} · ${cod}: días${textoDias(g.days) || ' todos'} →${textoDias(f.days) || ' todos'}`);
    }
  }
  return out;
}

/**
 * «Continuar» con el servicio del mes ya cargado: se actualiza con el del mes que se copia
 * (Obrador noviembre con Puesto 2 ×1 y octubre con Puesto 1 ×4). Solo si ese doc es del mes
 * (no un agrupado que cubre otros meses) y no está cerrado.
 */
export function decidirActualizarServicio(input: { slas: SlaConPuestos[]; year: number; month: number }): DecisionActualizarServicio {
  const mes = nombreMes(input.month - 1);
  const desde = ymd(input.year, input.month, 1);
  const hasta = ultimoDia(input.year, input.month);
  const prev = mesPrevio(input.year, input.month);
  const prevDesde = ymd(prev.y, prev.m, 1);
  const prevHasta = ultimoDia(prev.y, prev.m);
  const pool = input.slas.filter(abierto);
  const target = pool.find((s) => dia(s.startDate) <= desde && dia(s.endDate) >= hasta);
  if (!target) return { accion: 'nada' };
  const base = pool.filter((s) => s.id !== target.id && dia(s.startDate) <= prevHasta && dia(s.endDate) >= prevDesde)
    .sort((a, b) => dia(b.endDate).localeCompare(dia(a.endDate)))[0];
  if (!base) return { accion: 'nada' };
  const cambios = cambiosDeServicio(base.positions || [], target.positions || []);
  if ((base.exigeCobertura !== false) !== (target.exigeCobertura !== false)) {
    cambios.push(`Exige cobertura: ${target.exigeCobertura !== false ? 'sí' : 'no'} → ${base.exigeCobertura !== false ? 'sí' : 'no'}`);
  }
  if (!cambios.length) return { accion: 'nada' };
  if (target.closed) return { accion: 'no_se_puede', mes, motivo: `El servicio de ${mes} está cerrado.` };
  if (dia(target.startDate) < desde || dia(target.endDate) > hasta) {
    return { accion: 'no_se_puede', mes, motivo: `El servicio de ${mes} también cubre otros meses: editalo desde Servicios.` };
  }
  return { accion: 'actualizar', mes, mesBase: nombreMes(prev.m - 1), baseId: base.id, targetId: target.id, cambios };
}

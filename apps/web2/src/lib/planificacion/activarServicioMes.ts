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

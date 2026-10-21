/**
 * Arma el doc de servicios_sla del mes M. Puro: no escribe.
 * Automático: solo el mes anterior (M-1), abierto y con cliente activo.
 * Manual: puede usar el último SLA si falta M-1, marcando confirmación.
 * El espejo de Functions es apps/functions/src/servicios/copiarSlaMes.ts.
 */
import { franjasParaMesSiguiente } from '@/lib/planificacion/refuerzosRapido';
import { calculateSlaHoursForMonth } from '@/lib/servicios/slaHoursCalculator';
import { newSlaSeriesId } from '@/lib/servicios/slaMonthSplit';
import type { ServicePosition, SlaChangeLogEntry } from '@/services/slaService';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export type SlaParaCopiar = {
  id?: string;
  clientId?: string;
  clientName?: string;
  objectiveId?: string;
  objectiveName?: string;
  empresaId?: string;
  startDate?: unknown;
  endDate?: unknown;
  status?: unknown;
  closed?: unknown;
  closedReason?: unknown;
  positions?: unknown;
  slaSeriesId?: unknown;
  billingMode?: unknown;
  billingFixedMonthlyHours?: unknown;
  billingFixedMonthlyAmount?: unknown;
  billingPurchaseOrderId?: unknown;
  encargadoEmployeeId?: unknown;
  encargadoEmployeeName?: unknown;
  autoRenewMonthly?: unknown;
  exigeCobertura?: unknown;
  excludedDates?: unknown;
  horarioVersiones?: unknown;
  positionAssignments?: unknown;
  serviceRules?: unknown;
  serviceRotations?: unknown;
  [key: string]: unknown;
};

export type ClienteCopiaSla = {
  status?: unknown;
  active?: unknown;
  isActive?: unknown;
};

export type DecisionCopiaSla =
  | { accion: 'existe' }
  | { accion: 'sin_origen' }
  | {
      accion: 'omitir';
      motivo: 'cliente_inactivo' | 'hueco' | 'origen_cerrado';
      aviso: string;
      mesOrigen: string;
      mesOrigenNombre: string;
      mesNombre: string;
      origenCerrado: boolean;
      conHueco: boolean;
      /** El botón manual puede copiarlo (el cliente sigue activo y hay un SLA de origen). */
      puedeManual: boolean;
    }
  | {
      accion: 'crear';
      doc: Record<string, unknown>;
      origenId: string;
      mesOrigen: string;
      mesOrigenNombre: string;
      mesNombre: string;
      /** Hay que escribir este id en el origen. null si ya tenía serie. */
      serieNuevaEnOrigen: string | null;
      origenCerrado: boolean;
      conHueco: boolean;
      /** Hueco o origen cerrado/vencido: hay que confirmar antes de escribir. */
      requiereConfirmacion: boolean;
      aviso: string;
    };

export type OpcionesCopiaSla = {
  ahora?: string;
  seriesId?: string;
  actor?: { uid?: string; name?: string };
  /** `automatico` (default): solo M-1 abierto y cliente activo. `manual`: último SLA, con confirmación si hay hueco o está cerrado. */
  modo?: 'automatico' | 'manual';
  /** Documento de `clients`. Sin dato no se trata como inactivo. */
  cliente?: ClienteCopiaSla | null;
};

export type ClasePrepararServicio =
  | { clase: 'vigente' }
  | { clase: 'copiable'; mesOrigenNombre: string }
  | { clase: 'fuera'; nota: string }
  | { clase: 'sin'; nota: string };

const pad = (n: number) => String(n).padStart(2, '0');

export function nombreMesDeClave(mesKey: string): string {
  const m = Number(String(mesKey || '').slice(5, 7));
  return MESES[m - 1] || String(mesKey || '');
}

export function limitesMes(mesKey: string): { year: number; month: number; start: string; end: string } {
  const [ys, ms] = String(mesKey || '').split('-');
  const year = Number(ys);
  const month = Number(ms);
  const last = new Date(year, month, 0).getDate();
  return { year, month, start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

export function mesAnterior(mesKey: string): string {
  const { year, month } = limitesMes(mesKey);
  const m = month === 1 ? 12 : month - 1;
  const y = month === 1 ? year - 1 : year;
  return `${y}-${pad(m)}`;
}

export function ymdSla(value: unknown): string {
  if (value == null || value === '') return '';
  const t = value as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') {
    const d = t.toDate();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof t.seconds === 'number') {
    const d = new Date(t.seconds * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return String(value).slice(0, 10);
}

export function slaInactivo(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  return st === 'inactive' || st === 'inactivo' || st === 'cancelled' || st === 'cancelado';
}

/** Cliente fuera de operación: status inactivo o flags active / isActive en false. */
export function clienteInactivoParaCopia(cliente: ClienteCopiaSla | null | undefined): boolean {
  if (cliente == null) return false;
  if (cliente.active === false || cliente.isActive === false) return true;
  const u = String(cliente.status ?? '').trim().toUpperCase();
  return u === 'INACTIVE' || u === 'INACTIVO' || u === 'SUSPENDED' || u === 'SUSPENDIDO';
}

/** Cerrado en Servicios, o motivo VENCIDO. */
export function slaOrigenCerrado(sla: { closed?: unknown; closedReason?: unknown }): boolean {
  if (sla.closed === true) return true;
  return String(sla.closedReason ?? '').trim().toUpperCase() === 'VENCIDO';
}

export function avisoUltimoServicio(mesNombre: string, mesOrigenNombre: string, cerrado: boolean): string {
  const marca = cerrado ? ' (cerrado/vencido)' : '';
  return `${mesNombre} no tiene servicio; el último es ${mesOrigenNombre}${marca}. Crealo desde Servicios o con el botón si sigue vigente`;
}

/**
 * Un SLA no inactivo cuyas fechas tocan M ya ocupa el mes.
 * Uno viejo que sigue `status: active` con `closed` / VENCIDO también cuenta: no se duplica.
 */
export function slaCubreMes(sla: SlaParaCopiar, mesKey: string): boolean {
  if (slaInactivo(sla.status)) return false;
  const { start, end } = limitesMes(mesKey);
  const s = ymdSla(sla.startDate);
  const e = ymdSla(sla.endDate);
  if (!s || !e) return false;
  return s <= end && e >= start;
}

function porFinDesc(a: SlaParaCopiar, b: SlaParaCopiar): number {
  const fin = ymdSla(b.endDate).localeCompare(ymdSla(a.endDate));
  if (fin) return fin;
  const cerrado = Number(a.closed === true) - Number(b.closed === true);
  if (cerrado) return cerrado;
  return ymdSla(b.startDate).localeCompare(ymdSla(a.startDate));
}

/** SLA no inactivo que cubre M-1. Incluye cerrado/vencido: el llamador decide si sirve. */
export function elegirOrigenInmediato(slas: readonly SlaParaCopiar[], mesKey: string): SlaParaCopiar | null {
  const prev = mesAnterior(mesKey);
  return slas.filter((s) => slaCubreMes(s, prev)).sort(porFinDesc)[0] || null;
}

/** M-1 si lo cubre algún SLA; si no, el que termina más cerca antes de M. */
export function elegirOrigenCopiaSla(slas: readonly SlaParaCopiar[], mesKey: string): SlaParaCopiar | null {
  const inmediato = elegirOrigenInmediato(slas, mesKey);
  if (inmediato) return inmediato;
  const vivos = slas.filter((s) => !slaInactivo(s.status) && ymdSla(s.endDate));
  const { start } = limitesMes(mesKey);
  const anteriores = vivos.filter((s) => ymdSla(s.endDate) < start).sort(porFinDesc);
  return anteriores[0] || null;
}

function mesDeFin(sla: SlaParaCopiar): string {
  return ymdSla(sla.endDate).slice(0, 7);
}

function sinVacios(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function mesOrigenDe(origen: SlaParaCopiar, mesKey: string): string {
  if (slaCubreMes(origen, mesAnterior(mesKey))) return mesAnterior(mesKey);
  return mesDeFin(origen) || ymdSla(origen.startDate).slice(0, 7);
}

function omitirDe(
  origen: SlaParaCopiar,
  mesKey: string,
  motivo: 'cliente_inactivo' | 'hueco' | 'origen_cerrado',
): Extract<DecisionCopiaSla, { accion: 'omitir' }> {
  const mesOrigen = mesOrigenDe(origen, mesKey);
  const origenCerrado = slaOrigenCerrado(origen);
  const mesNombre = nombreMesDeClave(mesKey);
  const mesOrigenNombre = nombreMesDeClave(mesOrigen);
  return {
    accion: 'omitir',
    motivo,
    aviso: avisoUltimoServicio(mesNombre, mesOrigenNombre, origenCerrado),
    mesOrigen,
    mesOrigenNombre,
    mesNombre,
    origenCerrado,
    conHueco: !slaCubreMes(origen, mesAnterior(mesKey)),
    puedeManual: motivo !== 'cliente_inactivo',
  };
}

function armarCopia(
  origen: SlaParaCopiar,
  mesKey: string,
  opts: OpcionesCopiaSla | undefined,
  requiereConfirmacion: boolean,
): Extract<DecisionCopiaSla, { accion: 'crear' }> {
  const { year, month, start, end } = limitesMes(mesKey);
  const positions = franjasParaMesSiguiente(
    clonar(Array.isArray(origen.positions) ? origen.positions : []),
    mesKey,
  ) as unknown as ServicePosition[];
  const excluded = Array.isArray(origen.excludedDates)
    ? (origen.excludedDates as unknown[]).map((f) => String(f)).filter((f) => f.startsWith(mesKey))
    : [];
  const horas = calculateSlaHoursForMonth(positions, start, end, excluded.length ? excluded : undefined, year, month - 1);
  const teniaSerie = String(origen.slaSeriesId || '').trim();
  const seriesId = teniaSerie || String(opts?.seriesId || '').trim() || newSlaSeriesId();
  const mesOrigen = mesOrigenDe(origen, mesKey);
  const ahora = opts?.ahora || new Date().toISOString();
  const mesOrigenNombre = nombreMesDeClave(mesOrigen);
  const mesNombre = nombreMesDeClave(mesKey);
  const origenCerrado = slaOrigenCerrado(origen);
  const log: SlaChangeLogEntry = {
    at: ahora,
    action: 'COPIA_MES_ANTERIOR',
    detail: `Copiado de ${mesOrigenNombre} (${mesOrigen}${origen.id ? `, ${origen.id}` : ''})`,
    ...(opts?.actor?.uid ? { byUid: opts.actor.uid } : {}),
    ...(opts?.actor?.name ? { byName: opts.actor.name } : {}),
  };
  const doc = sinVacios({
    clientId: origen.clientId,
    clientName: origen.clientName || '',
    objectiveId: origen.objectiveId,
    objectiveName: origen.objectiveName || '',
    empresaId: origen.empresaId || undefined,
    positions,
    billingMode: origen.billingMode ?? null,
    billingFixedMonthlyHours: origen.billingFixedMonthlyHours,
    billingFixedMonthlyAmount: origen.billingFixedMonthlyAmount,
    billingPurchaseOrderId: origen.billingPurchaseOrderId,
    encargadoEmployeeId: origen.encargadoEmployeeId || '',
    encargadoEmployeeName: origen.encargadoEmployeeName || '',
    ...(origen.autoRenewMonthly === true || origen.autoRenewMonthly === false ? { autoRenewMonthly: origen.autoRenewMonthly } : {}),
    ...(origen.exigeCobertura === false || origen.exigeCobertura === true ? { exigeCobertura: origen.exigeCobertura } : {}),
    ...(excluded.length ? { excludedDates: excluded } : {}),
    ...(origen.horarioVersiones ? { horarioVersiones: clonar(origen.horarioVersiones) } : {}),
    ...(origen.positionAssignments ? { positionAssignments: clonar(origen.positionAssignments) } : {}),
    ...(origen.serviceRules ? { serviceRules: clonar(origen.serviceRules) } : {}),
    ...(origen.serviceRotations ? { serviceRotations: clonar(origen.serviceRotations) } : {}),
    slaSeriesId: seriesId,
    status: 'active',
    closed: false,
    startDate: start,
    endDate: end,
    totalMonthlyHours: horas.total,
    changeLog: [log],
  });
  return {
    accion: 'crear',
    doc,
    origenId: String(origen.id || ''),
    mesOrigen,
    mesOrigenNombre,
    mesNombre,
    serieNuevaEnOrigen: !teniaSerie && origen.id ? seriesId : null,
    origenCerrado,
    conHueco: !slaCubreMes(origen, mesAnterior(mesKey)),
    requiereConfirmacion,
    aviso: avisoUltimoServicio(mesNombre, mesOrigenNombre, origenCerrado),
  };
}

/**
 * Decide si hay que crear el doc de M. No muta los SLA de entrada.
 * `existe` = ya hay uno (activo o cerrado/VENCIDO) que cubre M.
 * Automático no crea si falta M-1, el origen está cerrado o el cliente está inactivo.
 */
export function decidirCopiaSlaMes(
  slas: readonly SlaParaCopiar[],
  mesKey: string,
  opts?: OpcionesCopiaSla,
): DecisionCopiaSla {
  if (slas.some((s) => slaCubreMes(s, mesKey))) return { accion: 'existe' };
  const modo = opts?.modo ?? 'automatico';
  const inmediato = elegirOrigenInmediato(slas, mesKey);
  const ultimo = elegirOrigenCopiaSla(slas, mesKey);
  if (clienteInactivoParaCopia(opts?.cliente)) {
    return ultimo ? omitirDe(ultimo, mesKey, 'cliente_inactivo') : { accion: 'sin_origen' };
  }
  if (modo === 'automatico') {
    if (!inmediato) return ultimo ? omitirDe(ultimo, mesKey, 'hueco') : { accion: 'sin_origen' };
    if (slaOrigenCerrado(inmediato)) return omitirDe(inmediato, mesKey, 'origen_cerrado');
    return armarCopia(inmediato, mesKey, opts, false);
  }
  const origen = ultimo;
  if (!origen) return { accion: 'sin_origen' };
  const cerrado = slaOrigenCerrado(origen);
  const hueco = !slaCubreMes(origen, mesAnterior(mesKey));
  return armarCopia(origen, mesKey, opts, hueco || cerrado);
}

/**
 * «Preparar el mes»: cliente inactivo, o último SLA cerrado/vencido anterior a M-1,
 * van a «Fuera de operación» y no piden crear servicio.
 */
export function clasePrepararServicio(
  slas: readonly SlaParaCopiar[],
  mesKey: string,
  cliente?: ClienteCopiaSla | null,
): ClasePrepararServicio {
  const mesNombre = nombreMesDeClave(mesKey);
  if (clienteInactivoParaCopia(cliente)) return { clase: 'fuera', nota: 'Fuera de operación: cliente inactivo' };
  if (slas.some((s) => slaCubreMes(s, mesKey) && !slaOrigenCerrado(s))) return { clase: 'vigente' };
  if (slas.some((s) => slaCubreMes(s, mesKey))) {
    return { clase: 'fuera', nota: `Fuera de operación: el servicio de ${mesNombre} está cerrado/vencido` };
  }
  const ultimo = elegirOrigenCopiaSla(slas, mesKey);
  if (!ultimo) return { clase: 'sin', nota: `sin servicio de ${mesNombre}` };
  const cerrado = slaOrigenCerrado(ultimo);
  const cubrePrev = slaCubreMes(ultimo, mesAnterior(mesKey));
  const fin = ymdSla(ultimo.endDate);
  const finTxt = fin.length >= 10 ? `${fin.slice(8, 10)}/${fin.slice(5, 7)}/${fin.slice(0, 4)}` : fin;
  if (!cubrePrev && cerrado) {
    return { clase: 'fuera', nota: `Fuera de operación: el último servicio es ${nombreMesDeClave(mesOrigenDe(ultimo, mesKey))} (cerrado/vencido)` };
  }
  if (!cubrePrev || cerrado) {
    return { clase: 'sin', nota: `sin servicio de ${mesNombre} y el último termina el ${finTxt}: cargalo en Servicios` };
  }
  return { clase: 'copiable', mesOrigenNombre: nombreMesDeClave(mesAnterior(mesKey)) };
}

export type ItemCopiaMasiva = {
  nombre: string;
  oid?: string;
  decision: DecisionCopiaSla;
};

/** La acción masiva crea solo M-1 abierto de clientes activos. El hueco se lista y no se escribe. */
export function partirCopiaMasiva(items: readonly ItemCopiaMasiva[]): {
  aCrear: Array<ItemCopiaMasiva & { decision: Extract<DecisionCopiaSla, { accion: 'crear' }> }>;
  yaExistian: number;
  sinOrigen: number;
  conHueco: string[];
  inactivos: string[];
  cerrados: string[];
} {
  const aCrear: Array<ItemCopiaMasiva & { decision: Extract<DecisionCopiaSla, { accion: 'crear' }> }> = [];
  const conHueco: string[] = [];
  const inactivos: string[] = [];
  const cerrados: string[] = [];
  let yaExistian = 0;
  let sinOrigen = 0;
  for (const item of items) {
    const d = item.decision;
    if (d.accion === 'existe') yaExistian += 1;
    else if (d.accion === 'sin_origen') sinOrigen += 1;
    else if (d.accion === 'omitir' && d.motivo === 'cliente_inactivo') inactivos.push(item.nombre);
    else if (d.accion === 'omitir' && d.conHueco) conHueco.push(item.nombre);
    else if (d.accion === 'omitir') cerrados.push(item.nombre);
    else if (d.conHueco) conHueco.push(item.nombre);
    else if (d.requiereConfirmacion || d.origenCerrado) cerrados.push(item.nombre);
    else aCrear.push(item as ItemCopiaMasiva & { decision: Extract<DecisionCopiaSla, { accion: 'crear' }> });
  }
  return { aCrear, yaExistian, sinOrigen, conHueco, inactivos, cerrados };
}

export function resumirCopias(decisiones: readonly DecisionCopiaSla[]): { creados: number; yaExistian: number; sinOrigen: number } {
  return {
    creados: decisiones.filter((d) => d.accion === 'crear').length,
    yaExistian: decisiones.filter((d) => d.accion === 'existe').length,
    sinOrigen: decisiones.filter((d) => d.accion === 'sin_origen').length,
  };
}

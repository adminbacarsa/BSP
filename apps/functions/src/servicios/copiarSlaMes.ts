/**
 * Espejo de apps/web2/src/lib/servicios/copiarSlaMes.ts. Functions no importa web2.
 * Si cambia la decisión o el doc allá, hay que cambiarlo acá.
 * Automático: solo M-1 abierto y cliente activo. Manual: último SLA con confirmación si hay hueco o está cerrado.
 */
import { franjasParaMesSiguiente } from './franjasMesSiguiente';
import { horasSlaDelMes } from './horasMesSla';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export type SlaParaCopiar = {
  id?: string;
  startDate?: unknown;
  endDate?: unknown;
  status?: unknown;
  closed?: unknown;
  positions?: unknown;
  slaSeriesId?: unknown;
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
      puedeManual: boolean;
    }
  | {
      accion: 'crear';
      doc: Record<string, unknown>;
      origenId: string;
      mesOrigen: string;
      mesOrigenNombre: string;
      mesNombre: string;
      serieNuevaEnOrigen: string | null;
      origenCerrado: boolean;
      conHueco: boolean;
      requiereConfirmacion: boolean;
      aviso: string;
    };

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

export function clienteInactivoParaCopia(cliente: ClienteCopiaSla | null | undefined): boolean {
  if (cliente == null) return false;
  if (cliente.active === false || cliente.isActive === false) return true;
  const u = String(cliente.status ?? '').trim().toUpperCase();
  return u === 'INACTIVE' || u === 'INACTIVO' || u === 'SUSPENDED' || u === 'SUSPENDIDO';
}

export function slaOrigenCerrado(sla: { closed?: unknown; closedReason?: unknown }): boolean {
  if (sla.closed === true) return true;
  return String(sla.closedReason ?? '').trim().toUpperCase() === 'VENCIDO';
}

export function avisoUltimoServicio(mesNombre: string, mesOrigenNombre: string, cerrado: boolean): string {
  const marca = cerrado ? ' (cerrado/vencido)' : '';
  return `${mesNombre} no tiene servicio; el último es ${mesOrigenNombre}${marca}. Crealo desde Servicios o con el botón si sigue vigente`;
}

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

export function elegirOrigenInmediato(slas: readonly SlaParaCopiar[], mesKey: string): SlaParaCopiar | null {
  const prev = mesAnterior(mesKey);
  return slas.filter((s) => slaCubreMes(s, prev)).sort(porFinDesc)[0] || null;
}

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

function newSlaSeriesId(now = Date.now()): string {
  return `sla_series_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

export function decidirCopiaSlaMes(
  slas: readonly SlaParaCopiar[],
  mesKey: string,
  opts?: {
    ahora?: string;
    seriesId?: string;
    actor?: { uid?: string; name?: string };
    modo?: 'automatico' | 'manual';
    cliente?: ClienteCopiaSla | null;
  },
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
  } else if (!ultimo) return { accion: 'sin_origen' };
  const origen = (modo === 'automatico' ? inmediato : ultimo) as SlaParaCopiar;
  const cerrado = slaOrigenCerrado(origen);
  const hueco = !slaCubreMes(origen, mesAnterior(mesKey));
  const { year, month, start, end } = limitesMes(mesKey);
  const positions = franjasParaMesSiguiente(clonar(Array.isArray(origen.positions) ? origen.positions : []) as Parameters<typeof franjasParaMesSiguiente>[0], mesKey);
  const excluded = Array.isArray(origen.excludedDates)
    ? (origen.excludedDates as unknown[]).map((f) => String(f)).filter((f) => f.startsWith(mesKey))
    : [];
  const horas = horasSlaDelMes(positions as never[], start, end, excluded.length ? excluded : undefined, year, month - 1);
  const teniaSerie = String(origen.slaSeriesId || '').trim();
  const seriesId = teniaSerie || String(opts?.seriesId || '').trim() || newSlaSeriesId();
  const mesOrigen = mesOrigenDe(origen, mesKey);
  const ahora = opts?.ahora || new Date().toISOString();
  const mesOrigenNombre = nombreMesDeClave(mesOrigen);
  const mesNombre = nombreMesDeClave(mesKey);
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
    totalMonthlyHours: horas,
    changeLog: [{
      at: ahora,
      action: 'COPIA_MES_ANTERIOR',
      detail: `Copiado de ${nombreMesDeClave(mesOrigen)} (${mesOrigen}${origen.id ? `, ${origen.id}` : ''})`,
      ...(opts?.actor?.uid ? { byUid: opts.actor.uid } : {}),
      ...(opts?.actor?.name ? { byName: opts.actor.name } : {}),
    }],
  });
  return {
    accion: 'crear',
    doc,
    origenId: String(origen.id || ''),
    mesOrigen,
    mesOrigenNombre,
    mesNombre,
    serieNuevaEnOrigen: !teniaSerie && origen.id ? seriesId : null,
    origenCerrado: cerrado,
    conHueco: hueco,
    requiereConfirmacion: modo === 'manual' && (hueco || cerrado),
    aviso: avisoUltimoServicio(mesNombre, mesOrigenNombre, cerrado),
  };
}

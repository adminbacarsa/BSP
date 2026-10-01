import { format, parse } from 'date-fns';
import type { ServiceSLA } from '@/services/slaService';
import { objectiveMonthSlaPresence } from '@/lib/crm/proformaOperation';
import { autoBillingModeLabel, billingModeLabel, hasExplicitSlaBillingMode, resolveSlaBillingMode } from '@/lib/crm/slaBilling';
import { slaCoversCalendarMonth } from '@/lib/firestoreDates';

export type ServicioMovilEstado = 'active' | 'withoutPlan' | 'closed' | 'none';

export const ESTADO_LABEL: Record<ServicioMovilEstado, string> = {
  active: 'En operación',
  withoutPlan: 'Con servicio sin operación',
  closed: 'Cerrado',
  none: 'Sin servicio',
};

export interface ServicioMovilRow {
  objectiveId: string;
  objectiveName: string;
  clientId: string;
  clientName: string;
  estado: ServicioMovilEstado;
  /** Contrato que se muestra: el que cubre el mes (abierto primero); si no, el más reciente. */
  sla: ServiceSLA | null;
  contratos: number;
  /** «Sin cronograma de octubre» / «Sin cronograma de noviembre»: meses con contrato abierto y sin publicar. */
  cronogramaAviso: string | null;
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Aviso de mes sin cronograma: el mes en curso y el siguiente que tengan un contrato abierto
 * vigente y sin `planificacion_estados` publicado. Sin contrato abierto en ese mes no hay aviso
 * (no entra en operación por falta de contrato, no de cronograma).
 */
export function avisoCronogramaObjetivo(input: {
  slas: readonly ServiceSLA[];
  year: number;
  monthIndex0: number;
  hasPublishedPlan: (year: number, month1to12: number) => boolean;
}): string | null {
  const meses: string[] = [];
  for (let paso = 0; paso < 2; paso += 1) {
    const total = input.monthIndex0 + paso;
    const year = input.year + Math.floor(total / 12);
    const monthIndex0 = total % 12;
    const abiertoDelMes = input.slas.some((s) => s.closed !== true && slaCoversCalendarMonth(s.startDate, s.endDate, year, monthIndex0));
    if (abiertoDelMes && !input.hasPublishedPlan(year, monthIndex0 + 1)) meses.push(MESES_ES[monthIndex0]);
  }
  if (!meses.length) return null;
  return `Sin cronograma de ${meses.join(' y ')}`;
}

export interface ServicioMovilClient {
  id: string;
  name?: string;
  status?: unknown;
  objectives?: Array<{ id?: string; name?: string; nombre?: string }>;
}

function ymd(value: unknown): string {
  return String(value ?? '').trim().slice(0, 10);
}

/** dd/MM/yyyy desde YYYY-MM-DD; vacío si no hay fecha. */
export function fechaCorta(value: unknown): string {
  const raw = ymd(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = parse(raw, 'yyyy-MM-dd', new Date());
  return Number.isNaN(date.getTime()) ? raw : format(date, 'dd/MM/yyyy');
}

function pickSla(slas: ServiceSLA[], year: number, monthIndex0: number): ServiceSLA | null {
  const delMes = slas.filter((s) => slaCoversCalendarMonth(s.startDate, s.endDate, year, monthIndex0));
  const abiertos = delMes.filter((s) => s.closed !== true);
  const byEnd = (a: ServiceSLA, b: ServiceSLA) => ymd(b.endDate).localeCompare(ymd(a.endDate));
  if (abiertos.length) return [...abiertos].sort(byEnd)[0];
  if (delMes.length) return [...delMes].sort(byEnd)[0];
  if (slas.length) return [...slas].sort(byEnd)[0];
  return null;
}

/**
 * Una fila por objetivo con el estado del mes en curso, con la misma regla que el libro y la prefactura
 * (`objectiveMonthSlaPresence`). Objetivos del cliente sin ningún contrato quedan como «Sin servicio».
 */
export function buildServiciosMovilRows(input: {
  services: ServiceSLA[];
  clients: ServicioMovilClient[];
  /** Cronograma publicado del objetivo en el mes (1–12): `isObjectivePlanificacionPublished`. */
  hasPublishedPlan: (objectiveId: string, year: number, month1to12: number) => boolean;
  now?: Date;
}): ServicioMovilRow[] {
  const now = input.now || new Date();
  const year = now.getFullYear();
  const monthIndex0 = now.getMonth();
  const clientById = new Map(input.clients.map((c) => [c.id, c]));
  const byObjective = new Map<string, ServiceSLA[]>();
  for (const srv of input.services) {
    const oid = String(srv.objectiveId || '').trim();
    if (!oid) continue;
    const list = byObjective.get(oid) || [];
    list.push(srv);
    byObjective.set(oid, list);
  }
  const rows: ServicioMovilRow[] = [];
  for (const [objectiveId, slas] of byObjective) {
    const sla = pickSla(slas, year, monthIndex0);
    const clientId = String(sla?.clientId || slas[0]?.clientId || '');
    const client = clientById.get(clientId);
    const estado = objectiveMonthSlaPresence({
      slas,
      year,
      monthIndex0,
      hasPublishedPlan: input.hasPublishedPlan(objectiveId, year, monthIndex0 + 1),
      clientStatus: client?.status,
    });
    rows.push({
      objectiveId,
      objectiveName: String(sla?.objectiveName || slas[0]?.objectiveName || objectiveId),
      clientId,
      clientName: String(client?.name || sla?.clientName || slas[0]?.clientName || ''),
      estado,
      sla,
      contratos: slas.length,
      cronogramaAviso: String(client?.status || 'ACTIVE').toUpperCase() === 'INACTIVE'
        ? null
        : avisoCronogramaObjetivo({ slas, year, monthIndex0, hasPublishedPlan: (y, m) => input.hasPublishedPlan(objectiveId, y, m) }),
    });
  }
  for (const client of input.clients) {
    for (const obj of client.objectives || []) {
      const oid = String(obj?.id || '').trim();
      if (!oid || byObjective.has(oid)) continue;
      rows.push({
        objectiveId: oid,
        objectiveName: String(obj?.name || obj?.nombre || oid),
        clientId: client.id,
        clientName: String(client.name || ''),
        estado: 'none',
        sla: null,
        contratos: 0,
        cronogramaAviso: null,
      });
    }
  }
  const order: Record<ServicioMovilEstado, number> = { active: 0, withoutPlan: 1, closed: 2, none: 3 };
  return rows.sort((a, b) => order[a.estado] - order[b.estado] || a.objectiveName.localeCompare(b.objectiveName, 'es'));
}

export interface ServicioMovilFranja {
  code: string;
  horario: string;
  quantity: number;
}

export interface ServicioMovilPuesto {
  name: string;
  quantity: number;
  franjas: ServicioMovilFranja[];
}

export interface ServicioMovilDetalle {
  vigencia: string;
  facturacion: string;
  cerrado: boolean;
  cerradoMotivo: string;
  reabiertoManual: boolean;
  puestos: ServicioMovilPuesto[];
}

/** Lo que se ve en el detalle del celular: vigencia, modo de facturación efectivo, puestos y franjas con cantidad. */
export function slaMovilDetalle(sla: ServiceSLA, ctx: { clientHasOpenContract?: boolean } = {}): ServicioMovilDetalle {
  const explicit = hasExplicitSlaBillingMode(sla);
  const facturacion = explicit
    ? billingModeLabel(resolveSlaBillingMode(sla, ctx))
    : autoBillingModeLabel(ctx);
  const closedReason = String((sla as { closedReason?: unknown }).closedReason || '');
  return {
    vigencia: `${fechaCorta(sla.startDate)} → ${fechaCorta(sla.endDate) || 'sin fin'}`,
    facturacion,
    cerrado: sla.closed === true,
    cerradoMotivo: closedReason === 'VENCIDO' ? 'vencido' : closedReason === 'MANUAL' ? 'manual' : '',
    reabiertoManual: (sla as { reopenedManually?: unknown }).reopenedManually === true,
    puestos: (sla.positions || []).map((pos) => ({
      name: pos.name || 'Puesto',
      quantity: Number(pos.quantity || 0),
      franjas: (pos.allowedShiftTypes || []).map((st) => ({
        code: st.code,
        horario: st.startTime && st.endTime ? `${st.startTime}–${st.endTime}` : '',
        quantity: Number(st.quantity ?? pos.quantity ?? 1),
      })),
    })),
  };
}

/** Mismas condiciones que los botones del escritorio (formulario del SLA). */
export function serviciosMovilAcciones(sla: ServiceSLA, isSuperAdmin: boolean): { cerrar: boolean; reabrir: boolean } {
  const cerrado = sla.closed === true;
  const reabierto = (sla as { reopenedManually?: unknown }).reopenedManually === true;
  return {
    reabrir: cerrado && isSuperAdmin,
    cerrar: !cerrado && isSuperAdmin && reabierto,
  };
}

/**
 * Crear el servicio del mes copiando el del mes anterior, antes de copiar, armar o pegar el cronograma.
 * Misma puerta que «Agregar meses» (un doc por mes, `slaSeriesId`, no pisa un SLA que ya cubre el mes).
 */
import { toYyyyMmDd } from '../firestoreDates';
import { decidirActivarServicio } from './activarServicioMes';
import { ejecutarAgregarMeses, proponerAgregarMeses, vistaPreviaAgregarMeses } from '../servicios/appendMonthsClient';

export type PlanServicioMes =
  | { estado: 'tiene' }
  | { estado: 'no_se_puede'; motivo: string; mes: string }
  | { estado: 'crear'; mes: string; run: (ctx: { empresaId: string; migracionCompleta: boolean; scopeEmpresa: boolean; via: string }) => Promise<unknown> };

/** `matching` = servicios de ese objetivo (ya filtrados); `month` 1-12. */
export function planServicioMes(input: { matching: any[]; year: number; month: number; clienteActivo: boolean }): PlanServicioMes {
  const decision = decidirActivarServicio({
    slas: input.matching.map((s) => ({
      id: s.id,
      startDate: toYyyyMmDd(s.startDate),
      endDate: toYyyyMmDd(s.endDate),
      closed: s.closed === true,
      status: String(s.status || ''),
    })),
    year: input.year,
    month: input.month,
    clienteActivo: input.clienteActivo,
  });
  if (!decision.mostrar) return { estado: 'tiene' };
  const seed = decision.puede && decision.lastId ? input.matching.find((s) => s.id === decision.lastId) : null;
  if (!seed) return { estado: 'no_se_puede', mes: decision.mes, motivo: decision.motivo || 'No hay servicio anterior para copiar: crealo en Servicios.' };
  const propuesta = { ...proponerAgregarMeses([seed], seed), last: seed };
  const preview = vistaPreviaAgregarMeses({ services: input.matching, last: propuesta.last, mode: propuesta.mode, newEndDate: decision.newEndDate });
  if (propuesta.error || preview.error) return { estado: 'no_se_puede', mes: decision.mes, motivo: String(propuesta.error || preview.error) };
  return {
    estado: 'crear',
    mes: decision.mes,
    run: (ctx) => ejecutarAgregarMeses({ services: input.matching, last: propuesta.last, plan: preview.plan, newEndDate: decision.newEndDate, ...ctx }),
  };
}

import { planificacionPublishLookupKey } from '@/lib/multiempresa';
import { planningMonthHasActiveSla } from '@/lib/slaPlanningMatch';

/**
 * Coherencia CC / Demo / Alertas (igual que Planificación):
 * 1) Contrato SLA vigente para el objetivo en el mes calendario.
 * 2) Cronograma publicado (`planificacion_estados.publishedAt`).
 * Turnos operativos (cobertura, RET, evento) se evalúan aparte en el monitor.
 */
export function isObjectiveEligibleForCcMonth(
    objectiveId: string,
    year: number,
    monthIndex0: number,
    publishStatusMap: Record<string, boolean>,
    servicesSLA: any[],
): boolean {
    const oid = String(objectiveId || '').trim();
    if (!oid) return false;

    const matching = (servicesSLA || []).filter((s) => String(s.objectiveId ?? '').trim() === oid);
    if (!planningMonthHasActiveSla(matching, year, monthIndex0)) return false;

    const month1 = monthIndex0 + 1;
    const pubKey = planificacionPublishLookupKey(oid, year, month1);
    if (publishStatusMap[pubKey]) return true;
    if (publishStatusMap[`${oid}_${year}_${month1}`]) return true;
    return false;
}

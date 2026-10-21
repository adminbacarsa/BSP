/**
 * Escritura de la copia de SLA. La decisión es `decidirCopiaSlaMes` (pura).
 */
import type { ServiceSLA } from '@/services/slaService';
import { slaService } from '@/services/slaService';
import type { DecisionCopiaSla } from '@/lib/servicios/copiarSlaMes';

export async function persistirCopiaSlaMes(
  decision: Extract<DecisionCopiaSla, { accion: 'crear' }>,
  ctx: { empresaId: string; migracionCompleta: boolean; scopeEmpresa: boolean; via?: string },
): Promise<string> {
  const row = { ...decision.doc } as unknown as ServiceSLA & { id?: string };
  delete row.id;
  const ref = await slaService.add(row, ctx.empresaId);
  if (decision.serieNuevaEnOrigen && decision.origenId && !decision.origenCerrado) {
    try {
      await slaService.update(decision.origenId, { slaSeriesId: decision.serieNuevaEnOrigen }, {
        empresaId: ctx.empresaId,
        migracionCompleta: ctx.migracionCompleta,
      });
    } catch (error) {
      console.error('[copia sla] no se pudo anotar slaSeriesId en el origen', error);
    }
  }
  return ref.id;
}

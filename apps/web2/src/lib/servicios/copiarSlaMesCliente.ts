/**
 * Escritura de la copia de SLA. La decisión es `decidirCopiaSlaMes` (pura).
 * Id fijo por objetivo+mes. La transacción relee ese doc: si ya cubre el mes no escribe; si está ocupado, falla.
 */
import type { ServiceSLA } from '@/services/slaService';
import { slaService } from '@/services/slaService';
import { doc, runTransaction, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import { idCopiaSlaMes, slaCubreMes, type DecisionCopiaSla, type SlaParaCopiar } from '@/lib/servicios/copiarSlaMes';

export async function persistirCopiaSlaMes(
  decision: Extract<DecisionCopiaSla, { accion: 'crear' }>,
  ctx: { empresaId: string; migracionCompleta: boolean; scopeEmpresa: boolean; via?: string },
): Promise<string> {
  const objectiveId = String(decision.doc.objectiveId || '').trim();
  const mesKey = String(decision.doc.startDate || '').slice(0, 7);
  if (!objectiveId || !/^\d{4}-\d{2}$/.test(mesKey)) throw new Error('copia sla sin objetivo o mes');
  const slaId = idCopiaSlaMes(objectiveId, mesKey);
  const ref = doc(db, 'servicios_sla', slaId);
  const row = stampEmpresaId({ ...decision.doc } as Record<string, unknown>, ctx.empresaId);
  delete (row as { id?: unknown }).id;

  const nuevo = await runTransaction(db, async (tx) => {
    const uno = await tx.get(ref);
    if (uno.exists()) {
      const propio: SlaParaCopiar = { id: uno.id, ...(uno.data() as SlaParaCopiar) };
      if (slaCubreMes(propio, mesKey)) return false;
      throw new Error('SLA_ID_OCUPADO');
    }
    tx.set(ref, row as DocumentData);
    return true;
  });

  if (nuevo && decision.serieNuevaEnOrigen && decision.origenId && !decision.origenCerrado) {
    try {
      await slaService.update(decision.origenId, { slaSeriesId: decision.serieNuevaEnOrigen } as Partial<ServiceSLA>, {
        empresaId: ctx.empresaId,
        migracionCompleta: ctx.migracionCompleta,
      });
    } catch (error) {
      console.error('[copia sla] no se pudo anotar slaSeriesId en el origen', error);
    }
  }
  return slaId;
}

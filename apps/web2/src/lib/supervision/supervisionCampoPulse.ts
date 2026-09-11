import type { LibroGuardiaEntry, ObjetivoConsigna, SupervisionVisita } from '@/services/supervisionFieldService';

export type SupervisionCampoPulseMetrics = {
  incidentesAbiertos: number;
  visitasMes: number;
  objetivosVisitadosMes: number;
  visitasCriticasMes: number;
  consignasActivas: number;
};

export function isLibroIncidenteAbierto(entry: Pick<LibroGuardiaEntry, 'etiqueta' | 'estadoIncidente'>): boolean {
  const isIncidente =
    entry.etiqueta === 'INCIDENTE'
    || entry.etiqueta === 'SINIESTRO'
    || !!entry.estadoIncidente;
  return isIncidente && entry.estadoIncidente !== 'CERRADO';
}

function isSameCalendarMonth(d: Date, ref: Date): boolean {
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

export function buildSupervisionCampoPulse(
  libro: LibroGuardiaEntry[],
  visitas: SupervisionVisita[],
  consignas: ObjetivoConsigna[],
  refDate = new Date(),
): SupervisionCampoPulseMetrics {
  const incidentesAbiertos = libro.filter(isLibroIncidenteAbierto).length;

  const visitasDelMes = visitas.filter(v => {
    const d = v.createdAt?.toDate?.();
    return d ? isSameCalendarMonth(d, refDate) : false;
  });

  const visitasMes = visitasDelMes.length;
  const objetivosVisitadosMes = new Set(visitasDelMes.map(v => v.objectiveId)).size;
  const visitasCriticasMes = visitasDelMes.filter(v => v.resultado === 'CRITICO').length;
  const consignasActivas = consignas.filter(c => c.status === 'ACTIVE').length;

  return {
    incidentesAbiertos,
    visitasMes,
    objetivosVisitadosMes,
    visitasCriticasMes,
    consignasActivas,
  };
}

export function supervisionCampoNavBadge(metrics: SupervisionCampoPulseMetrics): number {
  return metrics.incidentesAbiertos + metrics.visitasCriticasMes;
}

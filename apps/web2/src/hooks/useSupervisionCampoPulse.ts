import { useEffect, useMemo, useState } from 'react';
import { supervisionFieldService, type LibroGuardiaEntry, type ObjetivoConsigna, type SupervisionVisita } from '@/services/supervisionFieldService';
import {
  buildSupervisionCampoPulse,
  type SupervisionCampoPulseMetrics,
} from '@/lib/supervision/supervisionCampoPulse';

const EMPTY: SupervisionCampoPulseMetrics = {
  incidentesAbiertos: 0,
  visitasMes: 0,
  objetivosVisitadosMes: 0,
  visitasCriticasMes: 0,
  consignasActivas: 0,
};

export function useSupervisionCampoPulse(
  empresaId: string | undefined,
  objectiveIds: string[],
  canViewAllObjectives: boolean,
): SupervisionCampoPulseMetrics {
  const [libro, setLibro] = useState<LibroGuardiaEntry[]>([]);
  const [visitas, setVisitas] = useState<SupervisionVisita[]>([]);
  const [consignas, setConsignas] = useState<ObjetivoConsigna[]>([]);

  useEffect(() => {
    if (!objectiveIds.length) {
      setLibro([]);
      return;
    }
    return supervisionFieldService.subscribeLibroByObjectives(objectiveIds, setLibro, 50);
  }, [objectiveIds]);

  useEffect(() => {
    if (!empresaId) {
      setVisitas([]);
      setConsignas([]);
      return;
    }
    const ids = objectiveIds.length ? objectiveIds : (canViewAllObjectives ? null : []);
    const unsubVisitas = supervisionFieldService.subscribeVisitas(empresaId, ids, setVisitas);
    const unsubConsignas = supervisionFieldService.subscribeConsignas(empresaId, ids, setConsignas);
    return () => {
      unsubVisitas();
      unsubConsignas();
    };
  }, [empresaId, objectiveIds, canViewAllObjectives]);

  return useMemo(
    () => (objectiveIds.length || canViewAllObjectives
      ? buildSupervisionCampoPulse(libro, visitas, consignas)
      : EMPTY),
    [libro, visitas, consignas, objectiveIds.length, canViewAllObjectives],
  );
}

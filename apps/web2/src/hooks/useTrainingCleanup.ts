import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { TRAINABLE_MODULES } from '@/lib/training/trainingSession';
import {
  cleanupModuleData,
  calcModuleScore,
  saveModuleScore,
} from '@/lib/training/trainingCleanup';

/**
 * Observa la sesión de capacitación y, cuando un módulo pasa a "completed",
 * calcula el score y limpia los datos de práctica de ese módulo.
 */
export function useTrainingCleanup() {
  const { empresa } = useEmpresa();
  const { session } = useTrainingSession();
  // Guardamos qué módulos ya limpiamos en esta sesión para no repetir
  const cleanedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!empresa?.isTrainingEmpresa || !session) return;

    for (const moduleKey of session.modulePlan) {
      const modProgress = session.progress[moduleKey];
      if (modProgress?.status !== 'completed') continue;
      if (cleanedRef.current.has(moduleKey)) continue;

      // Ya fue completado y no lo procesamos todavía
      cleanedRef.current.add(moduleKey);

      const mod = TRAINABLE_MODULES.find(m => m.key === moduleKey);
      const modLabel = mod?.label ?? moduleKey;

      const score = calcModuleScore({
        attempts: modProgress.attempts,
        startedAt: modProgress.startedAt,
        completedAt: modProgress.completedAt,
      });

      // Guardar score y limpiar en paralelo
      Promise.all([
        saveModuleScore(session.id, moduleKey, score),
        cleanupModuleData(session, moduleKey),
      ])
        .then(([, { deleted }]) => {
          toast.success(
            `Módulo "${modLabel}" completado — score: ${score}/100`,
            {
              description: deleted > 0
                ? `${deleted} registros de práctica eliminados.`
                : 'Sin datos a eliminar.',
              duration: 6000,
            },
          );
        })
        .catch(err => {
          console.warn('[training:cleanup]', err);
        });
    }
  }, [empresa?.isTrainingEmpresa, session]);
}

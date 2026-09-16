import {
  collection, query, where, getDocs, writeBatch,
  Timestamp, doc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { TrainingSession } from './trainingSession';

/** Colecciones a limpiar por módulo al completarlo */
const CLEANUP_MAP: Record<string, string[]> = {
  CLIENTS:    ['clients'],
  SERVICES:   ['servicios_sla'],
  PLANNING:   ['turnos', 'planificacion_estados'],
  OPERATIONS: ['turnos', 'novedades', 'convocatorias_cobertura'],
  RRHH:       ['ausencias', 'novedades'],
  REPORTS:    [],   // solo lectura, nada que borrar
};

/**
 * Borra los datos de práctica de un módulo recién completado.
 * Filtra por empresaId + createdAt >= session.startedAt para no tocar seed.
 */
export async function cleanupModuleData(
  session: TrainingSession,
  moduleKey: string,
): Promise<{ deleted: number }> {
  const collections = CLEANUP_MAP[moduleKey] ?? [];
  if (collections.length === 0) return { deleted: 0 };

  const sessionStart = Timestamp.fromDate(new Date(session.startedAt));
  let totalDeleted = 0;

  for (const col of collections) {
    // planificacion_estados no tiene createdAt estándar → filtrar solo por empresaId
    const q = col === 'planificacion_estados'
      ? query(collection(db, col), where('empresaId', '==', session.empresaId))
      : query(
          collection(db, col),
          where('empresaId', '==', session.empresaId),
          where('createdAt', '>=', sessionStart),
        );

    const snap = await getDocs(q);
    if (snap.empty) continue;

    // Borrar en lotes de 450 (límite Firestore: 500 ops/batch)
    const BATCH_SIZE = 450;
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
      await batch.commit();
      totalDeleted += Math.min(BATCH_SIZE, snap.docs.length - i);
    }
  }

  return { deleted: totalDeleted };
}

/**
 * Calcula el score del módulo:
 * - Base 100
 * - -20 por cada intento extra (sobre 1)
 * - -10 si tardó más de 10 minutos en completarlo
 * Mínimo 0.
 */
export function calcModuleScore(params: {
  attempts: number;
  startedAt?: string;
  completedAt?: string;
}): number {
  const { attempts, startedAt, completedAt } = params;
  let score = 100;

  if (attempts > 1) score -= (attempts - 1) * 20;

  if (startedAt && completedAt) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    const minutes = ms / 60_000;
    if (minutes > 10) score -= 10;
  }

  return Math.max(0, score);
}

/**
 * Persiste el score en el doc de sesión (actualiza el campo progress[moduleKey].score).
 * Llama a esta función DESPUÉS de limpiar para que el score quede en la sesión
 * aunque ya no haya datos del módulo.
 */
export async function saveModuleScore(
  sessionId: string,
  moduleKey: string,
  score: number,
): Promise<void> {
  const { updateDoc } = await import('firebase/firestore');
  const ref = doc(db, 'training_sessions', sessionId);
  await updateDoc(ref, { [`progress.${moduleKey}.score`]: score });
}

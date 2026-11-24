/**
 * Mantiene al día `empleados.experienciaObjetivos` (pestaña Experiencia del legajo): una vez por noche
 * recalcula, desde el historial de turnos de los últimos 12 meses, en qué objetivos trabajó cada guardia.
 * De ahí salen «Conocido» / «En escuela» en Modo Rápido (retenes por destino), en la cobertura y en Planificación.
 *
 * Nunca baja un contador ya guardado y solo escribe los legajos que cambian: después de la primera corrida
 * la mayoría de las noches casi no escribe nada.
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  acumularExperiencia,
  mezclarExperiencia,
  type ExperienciaEntry,
  type TurnoExperiencia,
} from './experienciaObjetivosCalc';

const TZ = 'America/Argentina/Buenos_Aires';
const MESES_HISTORIAL = 12;
const BATCH_MAX = 400;

function aMs(v: unknown): number | null {
  if (!v) return null;
  const t = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  return null;
}

export interface ResultadoExperiencia {
  legajos: number;
  turnosLeidos: number;
  turnosTrabajados: number;
  legajosActualizados: number;
}

export async function recalcularExperienciaObjetivos(
  db: FirebaseFirestore.Firestore,
  opts: { ahoraMs?: number; meses?: number; escribir?: boolean } = {},
): Promise<ResultadoExperiencia> {
  const ahoraMs = opts.ahoraMs ?? Date.now();
  const meses = opts.meses ?? MESES_HISTORIAL;
  const escribir = opts.escribir !== false;
  const desde = Timestamp.fromMillis(ahoraMs - meses * 30 * 86_400_000);
  const hasta = Timestamp.fromMillis(ahoraMs);

  const empSnap = await db.collection('empleados').select('preferredObjectiveId', 'experienciaObjetivos').get();
  const legajos = new Map(empSnap.docs.map((d) => [d.id, d.data()]));

  const turnosSnap = await db
    .collection('turnos')
    .where('startTime', '>=', desde)
    .where('startTime', '<', hasta)
    .select(
      'employeeId',
      'objectiveId',
      'startTime',
      'code',
      'status',
      'origin',
      'draft',
      'isDeleted',
      'coverageSuperseded',
      'isAbsent',
      'deploymentRole',
      'positionName',
    )
    .get();

  const turnos: TurnoExperiencia[] = turnosSnap.docs.map((d) => {
    const t = d.data();
    return {
      employeeId: t.employeeId,
      objectiveId: t.objectiveId,
      code: t.code,
      status: t.status,
      origin: t.origin,
      draft: t.draft,
      isDeleted: t.isDeleted,
      coverageSuperseded: t.coverageSuperseded,
      isAbsent: t.isAbsent,
      deploymentRole: t.deploymentRole,
      positionName: t.positionName,
      startMs: aMs(t.startTime),
    };
  });

  const acumulado = acumularExperiencia(turnos, ahoraMs, new Set(legajos.keys()));
  let trabajados = 0;
  for (const porObjetivo of acumulado.values()) {
    for (const a of porObjetivo.values()) {
      trabajados += a.turnosEscuela + a.turnosRegulares + a.turnosRefuerzo + a.turnosConvocado;
    }
  }

  let batch = db.batch();
  let ops = 0;
  let actualizados = 0;
  for (const [empleadoId, porObjetivo] of acumulado) {
    const data = legajos.get(empleadoId);
    if (!data) continue;
    const exp = (data.experienciaObjetivos ?? {}) as Record<string, ExperienciaEntry & { ultimaPresencia?: unknown }>;
    const ultimaPresenciaPrevia: Record<string, number> = {};
    for (const [objetivoId, e] of Object.entries(exp)) {
      const ms = aMs(e?.ultimaPresencia);
      if (ms != null) ultimaPresenciaPrevia[objetivoId] = ms;
    }
    const mezcla = mezclarExperiencia(
      {
        preferredObjectiveId: data.preferredObjectiveId as string | undefined,
        experienciaObjetivos: exp,
        ultimaPresenciaPrevia,
      },
      porObjetivo,
    );
    if (!mezcla) continue;
    const salida: Record<string, unknown> = { ...mezcla.experiencia };
    for (const [objetivoId, ms] of Object.entries(mezcla.ultimaPresenciaMs)) {
      salida[objetivoId] = { ...(salida[objetivoId] as object), ultimaPresencia: Timestamp.fromMillis(ms) };
    }
    actualizados += 1;
    if (!escribir) continue;
    batch.update(db.collection('empleados').doc(empleadoId), { experienciaObjetivos: salida });
    ops += 1;
    if (ops >= BATCH_MAX) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (escribir && ops > 0) await batch.commit();

  return {
    legajos: legajos.size,
    turnosLeidos: turnos.length,
    turnosTrabajados: trabajados,
    legajosActualizados: actualizados,
  };
}

/** Todas las noches a las 03:30 (hora de Argentina). */
export const scheduledExperienciaObjetivos = onSchedule(
  { schedule: '30 3 * * *', timeZone: TZ, timeoutSeconds: 540, memory: '512MiB' },
  async () => {
    const r = await recalcularExperienciaObjetivos(admin.firestore());
    console.log(
      `[scheduledExperienciaObjetivos] legajos=${r.legajos} turnos=${r.turnosLeidos} trabajados=${r.turnosTrabajados} actualizados=${r.legajosActualizados}`,
    );
  },
);

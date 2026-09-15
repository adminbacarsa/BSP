import { collection, doc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  belongsToEmpresaView,
  buildPlanificacionEstadoDocId,
  empresaCollectionQuery,
  parsePlanificacionEstadoDocId,
  planificacionPublishLookupKey,
} from '@/lib/multiempresa';
import {
  buildDemandaByObjective,
  coveragePlannedFromDemandaRow,
  coveragePlannedTotalFromDemandaRow,
} from '@/lib/analisis/analisisDemanda';
import { buildObjectiveAliasesFromSla } from '@/lib/hoursBalance/buildHoursBalance';
import { buildSlaExclusionContext } from '@/lib/crm/slaExclusionForPlanned';
import { pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import { fichadaHoursForShift } from '@/lib/crm/fichadaHours';

export type CronogramaEstado =
  | 'PUBLICADO'
  | 'BORRADOR'
  | 'PUBLICADO_CON_CAMBIOS'
  | 'SIN_DATOS';

/** Banda visual del avance real vs plan publicado (marcador tipo semáforo). */
export type CronogramaAvanceBand = 'RED' | 'YELLOW' | 'GREEN' | 'NONE';

export interface CronogramaOverviewRow {
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
  year: number;
  month: number;
  estado: CronogramaEstado;
  draftShifts: number;
  publishedShifts: number;
  totalShifts: number;
  /** Ausencias sin cobertura asignada (sin coveredBy). */
  openVacancies: number;
  /** Horas planificadas totales (publicado + borrador) — grilla completa. */
  plannedHours: number;
  /** Horas del plan comprometido (solo no-draft) — lo que Ops/Análisis ven como plan. */
  publishedPlanHours: number;
  /** Horas reales fichadas del mes en el objetivo. */
  realHours: number;
  /** real / publishedPlan (0–1+); null si no hay plan publicado. */
  completionRatio: number | null;
  avanceBand: CronogramaAvanceBand;
  publishedBy: string;
  publishedAt: Date | null;
  lastModifiedAt: Date | null;
  lastModifiedBy: string;
  lookupKey: string;
}

function isOperationalOriginShift(data: Record<string, unknown>): boolean {
  const o = String(data?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
  if (data?.resolvedBy === 'OPERACIONES') return true;
  return false;
}

function turnoCuentaParaCrono(data: Record<string, unknown>, objectiveId: string): boolean {
  if (!data?.objectiveId || String(data.objectiveId) !== String(objectiveId)) return false;
  if (isOperationalOriginShift(data)) return false;
  return true;
}

function toDate(val: unknown): Date | null {
  if (!val) return null;
  try {
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate();
    }
    if (typeof (val as { seconds?: number }).seconds === 'number') {
      return new Date((val as { seconds: number }).seconds * 1000);
    }
    const d = new Date(val as string);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function deriveCronogramaEstado(
  hasPublishedAt: boolean,
  draftCount: number,
  publishedCount: number,
): CronogramaEstado {
  const total = draftCount + publishedCount;
  if (total === 0 && !hasPublishedAt) return 'SIN_DATOS';
  if (hasPublishedAt && draftCount === 0) return 'PUBLICADO';
  if (hasPublishedAt && draftCount > 0) return 'PUBLICADO_CON_CAMBIOS';
  return 'BORRADOR';
}

export function deriveCronogramaAvanceBand(ratio: number | null): CronogramaAvanceBand {
  if (ratio == null || !Number.isFinite(ratio)) return 'NONE';
  if (ratio < 0.34) return 'RED';
  if (ratio < 0.67) return 'YELLOW';
  return 'GREEN';
}

export const CRONOGRAMA_ESTADO_LABEL: Record<CronogramaEstado, string> = {
  PUBLICADO: 'Publicado',
  BORRADOR: 'Borrador',
  PUBLICADO_CON_CAMBIOS: 'Publicado · cambios sin republicar',
  SIN_DATOS: 'Sin cronograma',
};

const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

type ShiftCounts = { draft: number; published: number; openVacancies: number };

type ActivityMeta = { lastModifiedAt: Date | null; lastModifiedBy: string };

function shiftActorLabel(data: Record<string, unknown>): string {
  return String(
    data.actorName
    ?? data.creadoPorNombre
    ?? data.actor
    ?? '',
  ).trim();
}

function pickLaterActivity(current: ActivityMeta, candidateAt: Date | null, candidateBy: string): ActivityMeta {
  if (!candidateAt) return current;
  if (!current.lastModifiedAt || candidateAt.getTime() > current.lastModifiedAt.getTime()) {
    return {
      lastModifiedAt: candidateAt,
      lastModifiedBy: candidateBy || current.lastModifiedBy,
    };
  }
  return current;
}

/** Registra quién y cuándo tocó el cronograma del objetivo/mes (guardar, publicar, dotación). */
export async function touchPlanificacionEstadoActivity(params: {
  empresaId: string;
  objectiveId: string;
  year: number;
  month: number;
  actorName: string;
}): Promise<void> {
  const { empresaId, objectiveId, year, month, actorName } = params;
  if (!empresaId?.trim() || !objectiveId?.trim() || !actorName?.trim()) return;
  const stateKey = buildPlanificacionEstadoDocId(empresaId, objectiveId, year, month);
  await setDoc(doc(db, 'planificacion_estados', stateKey), {
    empresaId,
    objectiveId,
    objetivoId: objectiveId,
    year,
    month,
    año: year,
    mes: month,
    lastModifiedAt: serverTimestamp(),
    lastModifiedBy: actorName,
  }, { merge: true });
}

/** SuperAdmin: panorama de cronogramas por objetivo en un mes (cualquier estado). */
export async function loadCronogramaOverview(params: {
  empresaId: string;
  migracionCompleta: boolean;
  scopeEmpresa: boolean;
  year: number;
  month: number;
  clients: { id: string; name?: string; razonSocial?: string; objetivos?: { id?: string; name?: string }[] }[];
}): Promise<CronogramaOverviewRow[]> {
  const { empresaId, migracionCompleta, scopeEmpresa, year, month, clients } = params;
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0, 23, 59, 59, 999);

  const publishByLookup = new Map<string, {
    publishedBy: string;
    publishedAt: Date | null;
    lastModifiedAt: Date | null;
    lastModifiedBy: string;
  }>();

  const planifSnap = await getDocs(
    empresaCollectionQuery('planificacion_estados', empresaId, scopeEmpresa),
  );
  planifSnap.docs.forEach((d) => {
    if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
    const data = d.data() as Record<string, unknown>;
    const parsed = parsePlanificacionEstadoDocId(d.id);
    const objId = String(data.objectiveId ?? data.objetivoId ?? parsed?.objectiveId ?? '').trim();
    const y = Number(data.year ?? data.año ?? parsed?.year);
    const m = Number(data.month ?? data.mes ?? parsed?.month);
    if (!objId || !Number.isFinite(y) || !Number.isFinite(m) || y !== year || m !== month) return;
    const lookupKey = planificacionPublishLookupKey(objId, y, m);
    const publishedAt = toDate(data.publishedAt);
    const lastModifiedAt = toDate(data.lastModifiedAt) ?? publishedAt;
    const lastModifiedBy = String(data.lastModifiedBy ?? data.publishedBy ?? '');
    publishByLookup.set(lookupKey, {
      publishedBy: String(data.publishedBy ?? ''),
      publishedAt,
      lastModifiedAt,
      lastModifiedBy,
    });
  });

  const shiftCountsByObjective = new Map<string, ShiftCounts>();
  const turnosByObjective = new Map<string, any[]>();
  const activityFromShifts = new Map<string, ActivityMeta>();
  const realHoursByObjective = new Map<string, number>();

  const svcSnap = await getDocs(
    empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa),
  );
  const slaRaw: any[] = [];
  svcSnap.docs.forEach((d) => {
    const data: any = { id: d.id, ...d.data() };
    if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
    slaRaw.push(data);
  });
  const vigenteSlas = pickVigenteSlasForPeriod(slaRaw, firstDay, lastDay);
  const objectiveAliases = buildObjectiveAliasesFromSla(vigenteSlas);
  const slaExclusionCtx = buildSlaExclusionContext(vigenteSlas, firstDay, lastDay);

  const turnosQ = scopeEmpresa
    ? query(
        collection(db, 'turnos'),
        where('empresaId', '==', empresaId),
        where('startTime', '>=', Timestamp.fromDate(firstDay)),
        where('startTime', '<=', Timestamp.fromDate(lastDay)),
      )
    : query(
        collection(db, 'turnos'),
        where('startTime', '>=', Timestamp.fromDate(firstDay)),
        where('startTime', '<=', Timestamp.fromDate(lastDay)),
      );

  const shiftsSnap = await getDocs(turnosQ);
  shiftsSnap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
    const objId = String(data.objectiveId || '').trim();
    if (!objId) return;

    // Horas reales: fichadas del objetivo (incl. ops), no inventa si no fichó.
    const realHs = fichadaHoursForShift({ id: d.id, ...data });
    if (realHs > 0) {
      realHoursByObjective.set(objId, (realHoursByObjective.get(objId) || 0) + realHs);
    }

    if (!turnoCuentaParaCrono(data, objId)) return;
    const counts = shiftCountsByObjective.get(objId) || { draft: 0, published: 0, openVacancies: 0 };
    const code = String(data.code || '').toUpperCase();
    if (ABSENCE_CODES.has(code) && !data.coveredBy) {
      counts.openVacancies += 1;
    } else if (data.draft === true) {
      counts.draft += 1;
    } else {
      counts.published += 1;
    }
    shiftCountsByObjective.set(objId, counts);

    const list = turnosByObjective.get(objId) || [];
    list.push({ id: d.id, ...data });
    turnosByObjective.set(objId, list);

    const createdAt = toDate(data.createdAt) ?? toDate(data.updatedAt);
    const actor = shiftActorLabel(data);
    const prev = activityFromShifts.get(objId) || { lastModifiedAt: null, lastModifiedBy: '' };
    activityFromShifts.set(objId, pickLaterActivity(prev, createdAt, actor));
  });

  const allObjectiveTurnos = [...turnosByObjective.values()].flat();
  const demandaOverview = buildDemandaByObjective({
    turnos: allObjectiveTurnos,
    ausenciasStats: null,
    vigenteServices: vigenteSlas,
    periodStart: firstDay,
    periodEnd: lastDay,
    objectiveAliases,
    slaExclusionCtx,
  });
  const plannedTotalByObjective = new Map<string, number>(
    demandaOverview.rows.map((r) => [r.id, coveragePlannedTotalFromDemandaRow(r)]),
  );
  const plannedPublishedByObjective = new Map<string, number>(
    demandaOverview.rows.map((r) => [r.id, coveragePlannedFromDemandaRow(r)]),
  );

  const rows: CronogramaOverviewRow[] = [];

  for (const client of clients) {
    const clientName = client.razonSocial || client.name || client.id;
    const objetivos = client.objetivos || [];
    for (const obj of objetivos) {
      const objectiveId = String(obj.id || obj.name || '').trim();
      if (!objectiveId) continue;
      const objectiveName = String(obj.name || objectiveId);
      const lookupKey = planificacionPublishLookupKey(objectiveId, year, month);
      const pub = publishByLookup.get(lookupKey);
      const counts = shiftCountsByObjective.get(objectiveId) || { draft: 0, published: 0, openVacancies: 0 };
      const shiftActivity = activityFromShifts.get(objectiveId);
      const mergedActivity = pickLaterActivity(
        {
          lastModifiedAt: pub?.lastModifiedAt ?? null,
          lastModifiedBy: pub?.lastModifiedBy || pub?.publishedBy || '',
        },
        shiftActivity?.lastModifiedAt ?? null,
        shiftActivity?.lastModifiedBy ?? '',
      );
      const estado = deriveCronogramaEstado(!!(pub?.publishedAt), counts.draft, counts.published);
      const plannedHours = plannedTotalByObjective.get(objectiveId) || 0;
      const publishedPlanHours = plannedPublishedByObjective.get(objectiveId) || 0;
      const realHours = Math.round((realHoursByObjective.get(objectiveId) || 0) * 10) / 10;
      const completionRatio =
        publishedPlanHours > 0 ? Math.min(2, realHours / publishedPlanHours) : null;
      const avanceBand = deriveCronogramaAvanceBand(completionRatio);

      rows.push({
        clientId: client.id,
        clientName,
        objectiveId,
        objectiveName,
        year,
        month,
        estado,
        draftShifts: counts.draft,
        publishedShifts: counts.published,
        totalShifts: counts.draft + counts.published,
        openVacancies: counts.openVacancies,
        plannedHours,
        publishedPlanHours,
        realHours,
        completionRatio,
        avanceBand,
        publishedBy: pub?.publishedBy || '',
        publishedAt: pub?.publishedAt ?? null,
        lastModifiedAt: mergedActivity.lastModifiedAt,
        lastModifiedBy: mergedActivity.lastModifiedBy,
        lookupKey,
      });
    }
  }

  const estadoOrder: Record<CronogramaEstado, number> = {
    PUBLICADO_CON_CAMBIOS: 0,
    BORRADOR: 1,
    PUBLICADO: 2,
    SIN_DATOS: 3,
  };

  return rows.sort((a, b) => {
    const eo = estadoOrder[a.estado] - estadoOrder[b.estado];
    if (eo !== 0) return eo;
    const cn = a.clientName.localeCompare(b.clientName, 'es');
    if (cn !== 0) return cn;
    return a.objectiveName.localeCompare(b.objectiveName, 'es');
  });
}

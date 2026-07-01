import { collection, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  belongsToEmpresaView,
  empresaCollectionQuery,
  parsePlanificacionEstadoDocId,
  planificacionPublishLookupKey,
} from '@/lib/multiempresa';

export type CronogramaEstado =
  | 'PUBLICADO'
  | 'BORRADOR'
  | 'PUBLICADO_CON_CAMBIOS'
  | 'SIN_DATOS';

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
  publishedBy: string;
  publishedAt: Date | null;
  lookupKey: string;
}

function isOperationalOriginShift(data: Record<string, unknown>): boolean {
  const o = String(data?.origin || '').toUpperCase();
  if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
  if (data?.resolvedBy === 'OPERACIONES') return true;
  if (data?.isReten === true) return true;
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
  hasPublishDoc: boolean,
  draftCount: number,
  publishedCount: number,
): CronogramaEstado {
  const total = draftCount + publishedCount;
  if (total === 0 && !hasPublishDoc) return 'SIN_DATOS';
  if (hasPublishDoc && draftCount === 0) return 'PUBLICADO';
  if (hasPublishDoc && draftCount > 0) return 'PUBLICADO_CON_CAMBIOS';
  return 'BORRADOR';
}

export const CRONOGRAMA_ESTADO_LABEL: Record<CronogramaEstado, string> = {
  PUBLICADO: 'Publicado',
  BORRADOR: 'Borrador',
  PUBLICADO_CON_CAMBIOS: 'Publicado · cambios sin republicar',
  SIN_DATOS: 'Sin cronograma',
};

type ShiftCounts = { draft: number; published: number };

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

  const publishByLookup = new Map<string, { publishedBy: string; publishedAt: Date | null }>();

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
    publishByLookup.set(lookupKey, {
      publishedBy: String(data.publishedBy ?? ''),
      publishedAt: toDate(data.publishedAt),
    });
  });

  const shiftCountsByObjective = new Map<string, ShiftCounts>();

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
    if (!objId || !turnoCuentaParaCrono(data, objId)) return;
    const counts = shiftCountsByObjective.get(objId) || { draft: 0, published: 0 };
    if (data.draft === true) counts.draft += 1;
    else counts.published += 1;
    shiftCountsByObjective.set(objId, counts);
  });

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
      const counts = shiftCountsByObjective.get(objectiveId) || { draft: 0, published: 0 };
      const estado = deriveCronogramaEstado(!!pub, counts.draft, counts.published);

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
        publishedBy: pub?.publishedBy || '',
        publishedAt: pub?.publishedAt ?? null,
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

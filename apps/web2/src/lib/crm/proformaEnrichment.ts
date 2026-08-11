import type { ObjectiveMeta } from './objectiveIdentity';
import {
  alignSlaAliasesToClientObjectives,
  buildObjectiveAliasMap,
  fallbackObjectiveKey,
  isLikelyFirestoreDocId,
  resolveObjectiveDisplayName,
} from './objectiveIdentity';

export type ClientObjetivoRef = { id?: string; objectiveId?: string; name?: string };

export type EmpMetaEntry = { legajo?: string; name?: string };

function normKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeClientObjetivo(o: ClientObjetivoRef): { id: string; name: string } {
  const id = String(o.id ?? o.objectiveId ?? '').trim();
  const name = String(o.name ?? '').trim();
  return { id, name };
}

/** Índice de legajos por id de doc, uid Auth y número de legajo. */
export function buildEmployeeMetaIndex(
  byDocId: Record<string, EmpMetaEntry>,
): Record<string, EmpMetaEntry> {
  const index: Record<string, EmpMetaEntry> = { ...byDocId };
  for (const [docId, entry] of Object.entries(byDocId)) {
    if (!entry) continue;
    index[docId] = entry;
  }
  return index;
}

export function registerEmployeeMetaAliases(
  index: Record<string, EmpMetaEntry>,
  docId: string,
  data: { uid?: unknown; fileNumber?: unknown; legajo?: unknown; name?: unknown; lastName?: unknown; firstName?: unknown },
): void {
  const name =
    String(data.name ?? '').trim() ||
    `${String(data.lastName ?? '').trim()} ${String(data.firstName ?? '').trim()}`.trim();
  const legajo = String(data.fileNumber ?? data.legajo ?? '').trim();
  const entry: EmpMetaEntry = { legajo: legajo || '—', name: name || undefined };
  index[docId] = entry;
  const uid = String(data.uid ?? '').trim();
  if (uid) index[uid] = entry;
  if (legajo) {
    index[legajo] = entry;
    index[`legajo:${legajo}`] = entry;
  }
}

export function resolveEmployeeMeta(
  index: Record<string, EmpMetaEntry>,
  employeeId: string,
  employeeName?: string,
): EmpMetaEntry {
  const eid = String(employeeId ?? '').trim();
  const fromTurno = String(employeeName ?? '').trim();
  if (eid && index[eid]) return index[eid];
  if (fromTurno) return { legajo: '—', name: fromTurno };
  if (eid && eid !== 'unknown') {
    return { legajo: '—', name: `ID ${eid.slice(0, 10)}…` };
  }
  return { legajo: '—', name: 'Sin nombre' };
}

/** Resuelve legajos referenciados solo en turnos (inactivos, otro índice, etc.). */
export async function hydrateEmployeeMetaFromTurnoIds(
  index: Record<string, EmpMetaEntry>,
  employeeIds: Iterable<string>,
  loadEmployee: (docId: string) => Promise<Record<string, unknown> | null>,
  maxLookups = 120,
): Promise<void> {
  const pending: string[] = [];
  for (const raw of employeeIds) {
    const eid = String(raw ?? '').trim();
    if (!eid || eid === 'unknown' || eid === 'VACANTE') continue;
    if (!index[eid]) pending.push(eid);
  }
  const unique = [...new Set(pending)].slice(0, maxLookups);
  await Promise.all(
    unique.map(async (eid) => {
      const data = await loadEmployee(eid);
      if (!data) return;
      registerEmployeeMetaAliases(index, eid, data as Parameters<typeof registerEmployeeMetaAliases>[2]);
    }),
  );
}

export function findClientObjectiveForTurno(
  row: { objectiveId?: unknown; objectiveName?: unknown },
  objetivos: ClientObjetivoRef[],
): { id: string; name: string } | null {
  const oid = String(row.objectiveId ?? '').trim();
  const oname = String(row.objectiveName ?? '').trim();
  if (!oid && !oname) return null;

  for (const raw of objetivos) {
    const { id, name } = normalizeClientObjetivo(raw);
    if (!id && !name) continue;
    if (oid && (oid === id || normKey(oid) === normKey(id))) {
      return { id: id || oid, name: name || oname || id };
    }
    if (oname && name && (oname === name || normKey(oname) === normKey(name))) {
      return { id: oid || id, name };
    }
  }
  return null;
}

/** objectiveId en turno suele ser el doc id del SLA o un objectiveId legacy. */
export function findSlaObjectiveForTurno(
  row: { objectiveId?: unknown; objectiveName?: unknown; clientId?: unknown },
  slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string; clientId?: string }>,
): { id: string; name: string } | null {
  const oid = String(row.objectiveId ?? '').trim();
  const oname = String(row.objectiveName ?? '').trim();
  const rowCid = String(row.clientId ?? '').trim();
  for (const sla of slas) {
    const slaId = String(sla.id ?? '').trim();
    const slaOid = String(sla.objectiveId ?? '').trim();
    const slaName = String(sla.objectiveName ?? '').trim();
    const slaCid = String(sla.clientId ?? rowCid).trim();
    if (oid && (oid === slaId || oid === slaOid)) {
      const id = slaOid || oid;
      const name = slaName || (oname && !isLikelyFirestoreDocId(oname) ? oname : '') || id;
      if (name) return { id, name };
    }
    if (oid && slaCid && slaName && oid === fallbackObjectiveKey(slaCid, slaName)) {
      return { id: slaOid || oid, name: slaName };
    }
    if (oname && slaName && normKey(oname) === normKey(slaName)) {
      return { id: oid || slaOid || slaId, name: slaName };
    }
  }
  return null;
}

export function enrichTurnosForProforma<T extends Record<string, unknown>>(
  turnos: T[],
  opts: {
    clientId: string;
    objetivos: ClientObjetivoRef[];
    slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string; clientId?: string }>;
  },
): T[] {
  const aliases = buildObjectiveAliasMap(opts.clientId, opts.objetivos, opts.slas);
  const objetivos = (opts.objetivos || []).map(normalizeClientObjetivo).filter((o) => o.id || o.name);

  return turnos.map((raw) => {
    const t = { ...raw } as T & {
      objectiveId?: string;
      objectiveName?: string;
      clientId?: string;
    };
    t.clientId = String(t.clientId ?? opts.clientId);

    const fromClient = findClientObjectiveForTurno(t, opts.objetivos);
    if (fromClient) {
      t.objectiveId = fromClient.id;
      t.objectiveName = fromClient.name;
    } else {
      const fromSla = findSlaObjectiveForTurno(
        { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: t.clientId },
        opts.slas,
      );
      if (fromSla) {
        t.objectiveId = fromSla.id;
        t.objectiveName = fromSla.name;
      } else {
        const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: t.clientId };
        const display = resolveObjectiveDisplayName(rowCtx, aliases);
        if (display !== 'Objetivo sin nombre') t.objectiveName = display;
      }
    }

    const oid = String(t.objectiveId ?? '').trim();
    if (!String(t.objectiveName ?? '').trim() && oid) {
      const hit = objetivos.find((o) => o.id === oid || o.name === oid);
      if (hit?.name) t.objectiveName = hit.name;
    }

    return t;
  });
}

export function buildProformaObjectiveAliases(
  clientId: string,
  objetivos: ClientObjetivoRef[],
  slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string; clientId?: string }>,
): Record<string, ObjectiveMeta> {
  const normalized = (objetivos || []).map((o) => {
    const { id, name } = normalizeClientObjetivo(o);
    return { id: id || name, name: name || id };
  }).filter((o) => o.id || o.name);
  const aliases = buildObjectiveAliasMap(clientId, normalized, slas);
  alignSlaAliasesToClientObjectives(aliases, clientId, normalized, slas);
  return aliases;
}

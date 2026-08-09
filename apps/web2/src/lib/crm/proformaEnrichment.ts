import type { ObjectiveMeta } from './objectiveIdentity';
import {
  buildObjectiveAliasMap,
  resolveCanonicalObjectiveId,
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

function isLikelyFirestoreDocId(value: string): boolean {
  const s = String(value ?? '').trim();
  return s.length >= 15 && s.length <= 28 && /^[a-zA-Z0-9]+$/.test(s);
}

function levenshteinIds(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const row = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) row[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = row[j];
      row[j] = next;
    }
  }
  return row[t.length];
}

function fuzzyMatchObjectiveId(oid: string, id: string): boolean {
  if (!oid || !id) return false;
  if (oid === id || normKey(oid) === normKey(id)) return true;
  if (!isLikelyFirestoreDocId(oid) || !isLikelyFirestoreDocId(id)) return false;
  return levenshteinIds(oid, id) <= 3;
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
    if (oid && (oid === id || oid === name || normKey(oid) === normKey(id) || normKey(oid) === normKey(name) || fuzzyMatchObjectiveId(oid, id))) {
      return { id: id || oid, name: name || oname || id };
    }
    if (oname && name && (oname === name || normKey(oname) === normKey(name))) {
      return { id: id || oid, name };
    }
  }
  return null;
}

/** objectiveId en turno suele ser el doc id del SLA o un objectiveId legacy. */
export function findSlaObjectiveForTurno(
  row: { objectiveId?: unknown; objectiveName?: unknown },
  slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string }>,
): { id: string; name: string } | null {
  const oid = String(row.objectiveId ?? '').trim();
  const oname = String(row.objectiveName ?? '').trim();
  for (const sla of slas) {
    const slaId = String(sla.id ?? '').trim();
    const slaOid = String(sla.objectiveId ?? '').trim();
    const slaName = String(sla.objectiveName ?? '').trim();
    if (oid && (oid === slaId || oid === slaOid)) {
      const id = slaOid || oid;
      const name = slaName || oname || id;
      if (name) return { id, name };
    }
    if (oname && slaName && normKey(oname) === normKey(slaName)) {
      return { id: slaOid || slaId || oid, name: slaName };
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
      const fromSla = findSlaObjectiveForTurno(t, opts.slas);
      if (fromSla) {
        t.objectiveId = fromSla.id;
        t.objectiveName = fromSla.name;
      } else {
      const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: t.clientId };
      const canonical = resolveCanonicalObjectiveId(rowCtx, aliases);
      const display = resolveObjectiveDisplayName(rowCtx, aliases);
      if (canonical) t.objectiveId = canonical;
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
  });
  return buildObjectiveAliasMap(clientId, normalized, slas);
}

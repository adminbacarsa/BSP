export type ObjectiveMeta = {
  canonicalId: string;
  name: string;
  clientId?: string;
};

export function fallbackObjectiveKey(clientId: string, objectiveName: string): string {
  return `${clientId}_${objectiveName}`;
}

function normObjectiveNameKey(value: unknown): string {
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

function levenshtein(a: string, b: string): number {
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

function registerAlias(aliases: Record<string, ObjectiveMeta>, meta: ObjectiveMeta, key: string) {
  const k = String(key || '').trim();
  if (!k) return;
  aliases[k] = meta;
  const lower = k.toLowerCase();
  if (lower !== k && !aliases[lower]) aliases[lower] = meta;
}

function findMetaByObjectiveName(
  aliases: Record<string, ObjectiveMeta>,
  objectiveName: string,
): ObjectiveMeta | undefined {
  const needle = normObjectiveNameKey(objectiveName);
  if (!needle) return undefined;
  const seen = new Set<string>();
  for (const meta of Object.values(aliases)) {
    if (!meta?.canonicalId || seen.has(meta.canonicalId)) continue;
    seen.add(meta.canonicalId);
    if (normObjectiveNameKey(meta.name) === needle) return meta;
  }
  return undefined;
}

function collectDistinctMetas(aliases: Record<string, ObjectiveMeta>): ObjectiveMeta[] {
  const byCanon = new Map<string, ObjectiveMeta>();
  for (const meta of Object.values(aliases)) {
    if (!meta?.canonicalId) continue;
    if (!byCanon.has(meta.canonicalId)) byCanon.set(meta.canonicalId, meta);
  }
  return [...byCanon.values()];
}

/** Solo para etiquetas UI — no usar para agrupar horas facturables. */
function resolveFuzzyObjectiveMetaForDisplay(
  objectiveId: string,
  aliases: Record<string, ObjectiveMeta>,
): ObjectiveMeta | null {
  const oid = String(objectiveId ?? '').trim();
  if (!oid || !isLikelyFirestoreDocId(oid)) return null;
  const lower = oid.toLowerCase();
  let best: { meta: ObjectiveMeta; dist: number } | null = null;
  for (const meta of collectDistinctMetas(aliases)) {
    const cid = meta.canonicalId;
    if (!isLikelyFirestoreDocId(cid)) continue;
    if (cid.toLowerCase() === lower) return meta;
    const dist = levenshtein(lower, cid);
    if (dist > 3) continue;
    if (!best || dist < best.dist) best = { meta, dist };
  }
  return best?.meta ?? null;
}

export function buildObjectiveAliasMap(
  clientId: string,
  objetivos: Array<{ id?: string; name?: string }> = [],
  slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string; clientId?: string }> = [],
): Record<string, ObjectiveMeta> {
  const aliases: Record<string, ObjectiveMeta> = {};

  for (const obj of objetivos) {
    const canonicalId = String(obj.id || (obj as { objectiveId?: string }).objectiveId || obj.name || '').trim();
    if (!canonicalId) continue;
    const name = String(obj.name || canonicalId).trim();
    const meta: ObjectiveMeta = { canonicalId, name, clientId };
    registerAlias(aliases, meta, canonicalId);
    if (obj.id) registerAlias(aliases, meta, obj.id);
    if (obj.name) registerAlias(aliases, meta, obj.name);
    registerAlias(aliases, meta, fallbackObjectiveKey(clientId, name));
  }

  for (const sla of slas) {
    const objName = String(sla.objectiveName ?? '').trim();
    const oid = String(sla.objectiveId ?? '').trim();
    const cid = String(sla.clientId ?? clientId).trim();
    let canonicalId = oid || (objName && cid ? fallbackObjectiveKey(cid, objName) : '');
    if (!canonicalId && sla.id) canonicalId = sla.id;
    if (!canonicalId) continue;

    const existing = aliases[canonicalId] || (oid ? aliases[oid] : undefined);
    const meta: ObjectiveMeta = existing ?? {
      canonicalId,
      name: objName || canonicalId,
      clientId: cid || clientId,
    };
    if (objName && meta.name === canonicalId) meta.name = objName;
    registerAlias(aliases, meta, canonicalId);
    if (oid) registerAlias(aliases, meta, oid);
    if (objName) registerAlias(aliases, meta, objName);
    if (cid && objName) registerAlias(aliases, meta, fallbackObjectiveKey(cid, objName));
    if (sla.id) registerAlias(aliases, meta, sla.id);
  }

  return aliases;
}

export function objectiveMatchCandidates(row: {
  objectiveId?: unknown;
  objectiveName?: unknown;
  clientId?: unknown;
}): string[] {
  const cid = String(row.clientId ?? '').trim();
  const oid = String(row.objectiveId ?? '').trim();
  const name = String(row.objectiveName ?? '').trim();
  const keys: string[] = [];
  if (oid) keys.push(oid);
  if (oid) keys.push(oid.toLowerCase());
  if (name) keys.push(name);
  if (cid && name) keys.push(fallbackObjectiveKey(cid, name));
  return keys;
}

/** Id de agrupación en pre-factura: solo alias exactos; no fusiona sedes ni ids fuzzy. */
export function resolveCanonicalObjectiveId(
  row: { objectiveId?: unknown; objectiveName?: unknown; clientId?: unknown },
  aliases: Record<string, ObjectiveMeta>,
): string | null {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]) return aliases[key].canonicalId;
  }
  const oid = String(row.objectiveId ?? '').trim();
  if (oid) return oid;
  const cid = String(row.clientId ?? '').trim();
  const name = String(row.objectiveName ?? '').trim();
  if (cid && name) return fallbackObjectiveKey(cid, name);
  if (name) return name;
  return null;
}

export function resolveObjectiveDisplayName(
  row: { objectiveId?: unknown; objectiveName?: unknown; clientId?: unknown },
  aliases: Record<string, ObjectiveMeta>,
): string {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]?.name) return aliases[key].name;
  }
  const name = String(row.objectiveName ?? '').trim();
  if (name) {
    const byName = findMetaByObjectiveName(aliases, name);
    if (byName?.name) return byName.name;
    return name;
  }
  const rawOid = String(row.objectiveId ?? '').trim();
  if (rawOid && aliases[rawOid]?.name) return aliases[rawOid].name;
  if (rawOid && aliases[rawOid.toLowerCase()]?.name) return aliases[rawOid.toLowerCase()].name;
  const fuzzy = rawOid ? resolveFuzzyObjectiveMetaForDisplay(rawOid, aliases) : null;
  if (fuzzy?.name) return fuzzy.name;
  if (canonicalOidFromExactAlias(row, aliases)) {
    const c = canonicalOidFromExactAlias(row, aliases)!;
    if (aliases[c]?.name) return aliases[c].name;
  }
  if (rawOid) {
    return rawOid.length > 12 ? `${rawOid.slice(0, 10)}…` : rawOid;
  }
  return 'Objetivo sin nombre';
}

function canonicalOidFromExactAlias(
  row: { objectiveId?: unknown; objectiveName?: unknown; clientId?: unknown },
  aliases: Record<string, ObjectiveMeta>,
): string | null {
  for (const key of objectiveMatchCandidates(row)) {
    if (aliases[key]) return aliases[key].canonicalId;
  }
  return null;
}

/** Etiqueta visible en pre-factura cuando no hay nombre en CRM (varios objectiveId distintos). */
export function formatProformaObjectiveLabel(objectiveId: string, objectiveName: string): string {
  const name = String(objectiveName ?? '').trim();
  if (name && name !== 'Objetivo sin nombre') return name;
  const id = String(objectiveId ?? '').trim();
  if (!id) return 'Objetivo sin nombre';
  const short = id.length > 16 ? `${id.slice(0, 14)}…` : id;
  return `Objetivo sin nombre · ${short}`;
}

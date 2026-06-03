export type ObjectiveMeta = {
  canonicalId: string;
  name: string;
  clientId?: string;
};

export function fallbackObjectiveKey(clientId: string, objectiveName: string): string {
  return `${clientId}_${objectiveName}`;
}

function registerAlias(aliases: Record<string, ObjectiveMeta>, meta: ObjectiveMeta, key: string) {
  const k = String(key || '').trim();
  if (!k) return;
  aliases[k] = meta;
}

export function buildObjectiveAliasMap(
  clientId: string,
  objetivos: Array<{ id?: string; name?: string }> = [],
  slas: Array<{ id?: string; objectiveId?: string; objectiveName?: string; clientId?: string }> = [],
): Record<string, ObjectiveMeta> {
  const aliases: Record<string, ObjectiveMeta> = {};

  for (const obj of objetivos) {
    const canonicalId = String(obj.id || obj.name || '').trim();
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
  if (name) keys.push(name);
  if (cid && name) keys.push(fallbackObjectiveKey(cid, name));
  return keys;
}

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
  if (name) return name;
  const oid = resolveCanonicalObjectiveId(row, aliases);
  if (oid && aliases[oid]?.name) return aliases[oid].name;
  return 'Objetivo sin nombre';
}

import type { ServicePosition } from '@/services/slaService';

export type PaxBoostRange = {
  from: string;
  to: string;
  delta: number;
  solicitudId?: string;
  label?: string;
};

export function normalizeYmd(val: unknown): string {
  return String(val || '').trim().slice(0, 10);
}

/** Suma +pax temporal activo en una fecha (todas las bandas del puesto). */
export function paxBoostDeltaForDate(
  pos: Pick<ServicePosition, 'paxBoostRanges'> | null | undefined,
  dateStr: string,
): number {
  const d = normalizeYmd(dateStr);
  if (!d || !pos?.paxBoostRanges?.length) return 0;
  let boost = 0;
  for (const r of pos.paxBoostRanges) {
    const from = normalizeYmd(r.from);
    const to = normalizeYmd(r.to || r.from);
    if (!from) continue;
    if (d >= from && d <= to) boost += Math.max(0, Math.floor(Number(r.delta) || 0));
  }
  return boost;
}

export function appendPaxBoostRange(
  existing: PaxBoostRange[] | undefined,
  entry: PaxBoostRange,
): PaxBoostRange[] {
  return [...(existing || []), entry].slice(-40);
}

export function removePaxBoostBySolicitudId(
  existing: PaxBoostRange[] | undefined,
  solicitudId: string | undefined,
): PaxBoostRange[] {
  if (!solicitudId) return existing || [];
  return (existing || []).filter((r) => r.solicitudId !== solicitudId);
}

export function isTemporaryPaxBoost(from: string, to?: string, explicitEnd?: boolean): boolean {
  if (explicitEnd) return true;
  const f = normalizeYmd(from);
  const t = normalizeYmd(to || from);
  return !!f && !!t && t > f;
}

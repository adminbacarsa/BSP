import type {
  HoursBalanceRow,
  HoursBalanceSource,
  HoursBalanceWriteChannel,
} from './types';

export type HoursBalanceWriteMeta = {
  channel: HoursBalanceWriteChannel;
  /** Actor opcional (email / nombre) para trazabilidad. */
  actor?: string;
};

const CHANNEL_TO_SOURCE: Record<HoursBalanceWriteChannel, HoursBalanceSource> = {
  planning: 'planning',
  sla_patch: 'sla',
  analisis_refresh: 'analisis',
};

export function stampHoursBalanceRowsForWrite(
  rows: HoursBalanceRow[],
  meta: HoursBalanceWriteMeta,
): HoursBalanceRow[] {
  const source = CHANNEL_TO_SOURCE[meta.channel];
  const computedAtIso = new Date().toISOString();
  const actor = String(meta.actor || '').trim() || undefined;
  return rows.map((row) => ({
    ...row,
    rebuiltFrom: source,
    writeChannel: meta.channel,
    computedAtIso,
    ...(actor ? { writtenBy: actor } : {}),
  }));
}

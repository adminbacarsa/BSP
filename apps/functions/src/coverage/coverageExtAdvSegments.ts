import { Timestamp } from 'firebase-admin/firestore';
import { AR_OFFSET_MS, arHmOnDayMs, arHour } from '../common/arClock';

export type VacancySplitTimes = {
  gap: { from: string; to: string };
  ext: { from: string; to: string };
  adel: { from: string; to: string };
};

export function defaultSplitTimesCct(band: string): VacancySplitTimes {
  const b = String(band || 'M').toUpperCase();
  if (b === 'T') {
    return {
      gap: { from: '15:00', to: '23:00' },
      ext: { from: '15:00', to: '19:00' },
      adel: { from: '19:00', to: '23:00' },
    };
  }
  if (b === 'N' || b === 'N12') {
    return {
      gap: { from: '19:00', to: '07:00' },
      ext: { from: '19:00', to: '23:00' },
      adel: { from: '23:00', to: '07:00' },
    };
  }
  if (b === 'M' || b === 'D12') {
    return {
      gap: { from: '07:00', to: '15:00' },
      ext: { from: '07:00', to: '11:00' },
      adel: { from: '11:00', to: '15:00' },
    };
  }
  return {
    gap: { from: '15:00', to: '23:00' },
    ext: { from: '15:00', to: '19:00' },
    adel: { from: '19:00', to: '23:00' },
  };
}

function tsToDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (ts instanceof Date) return ts;
  return null;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

/** HH:mm en hora AR anclado al día calendario AR del ancla; si to <= from, `to` cae al día siguiente. */
export function hhmmPairToTimestamps(
  anchor: Date,
  fromHm: string,
  toHm: string,
): { start: Timestamp; end: Timestamp } {
  const f = parseHm(fromHm);
  const t = parseHm(toHm);
  const startMs = arHmOnDayMs(anchor.getTime(), f.h, f.m);
  let endMs = arHmOnDayMs(anchor.getTime(), t.h, t.m);
  if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
  return { start: Timestamp.fromMillis(startMs), end: Timestamp.fromMillis(endMs) };
}

export function resolveCoverageBandCode(opts: {
  code?: string | null;
  startTime?: unknown;
}): string {
  const c = String(opts.code || '').trim().toUpperCase();
  if (c && !['T', 'COBERTURA', ''].includes(c)) return c;
  const d = tsToDate(opts.startTime);
  if (!d) throw new Error('Falta código de banda del titular');
  const h = arHour(d.getTime());
  if (h >= 6 && h < 14) return 'M';
  if (h >= 14 && h < 22) return 'T';
  return 'N';
}

const MAX_GAP_SPAN_MS = 13 * 60 * 60 * 1000;

function arHm(ms: number): string {
  const d = new Date(ms - AR_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Segmentos Ext + Adel por el horario real del hueco (HH:MM del titular): Ext = inicio → mitad,
 * Adel = mitad → fin. Un M 07–15 corta 11:00 y un T 15–23 19:00 (igual que la tabla CCT); un
 * N 23–07 corta 03:00 y un puesto custom 12–16 a las 14:00. Sin horario válido, tabla por código.
 */
export function splitTimesForGap(opts: {
  gapBand: string;
  gapStartMs?: number;
  gapEndMs?: number;
}): VacancySplitTimes {
  const s = opts.gapStartMs || 0;
  const e = opts.gapEndMs || 0;
  if (s && e && e > s && e - s <= MAX_GAP_SPAN_MS) {
    const mid = s + Math.floor((e - s) / 2);
    return {
      gap: { from: arHm(s), to: arHm(e) },
      ext: { from: arHm(s), to: arHm(mid) },
      adel: { from: arHm(mid), to: arHm(e) },
    };
  }
  return defaultSplitTimesCct(opts.gapBand);
}

export function dualExtAdvSegmentTimestamps(opts: {
  titularAnchor: Date;
  gapBand: string;
  gapStartMs?: number;
  gapEndMs?: number;
}): {
  extCov: { start: Timestamp; end: Timestamp; extensionEndHm: string };
  advCov: { start: Timestamp; end: Timestamp; adjustedStartHm: string };
} {
  const split = splitTimesForGap(opts);
  const s = opts.gapStartMs || 0;
  const e = opts.gapEndMs || 0;
  if (s && e && e > s && e - s <= MAX_GAP_SPAN_MS) {
    // Directo en ms: un Adel 03:00–07:00 de un N 23–07 cae al día siguiente del ancla.
    const mid = s + Math.floor((e - s) / 2);
    return {
      extCov: { start: Timestamp.fromMillis(s), end: Timestamp.fromMillis(mid), extensionEndHm: split.ext.to },
      advCov: { start: Timestamp.fromMillis(mid), end: Timestamp.fromMillis(e), adjustedStartHm: split.adel.from },
    };
  }
  const extCov = hhmmPairToTimestamps(opts.titularAnchor, split.ext.from, split.ext.to);
  const advCov = hhmmPairToTimestamps(opts.titularAnchor, split.adel.from, split.adel.to);
  return {
    extCov: { ...extCov, extensionEndHm: split.ext.to },
    advCov: { ...advCov, adjustedStartHm: split.adel.from },
  };
}

/** Inicio/fin reales del hueco (titular) en ms; 0 si faltan. */
export function gapSpanFromShift(titular: Record<string, unknown>): { gapStartMs: number; gapEndMs: number } {
  const s = tsToDate(titular.startTime)?.getTime() || 0;
  const e = tsToDate(titular.endTime)?.getTime() || 0;
  return { gapStartMs: s, gapEndMs: e };
}

export function titularAnchorFromShift(titular: Record<string, unknown>): Date {
  const d = tsToDate(titular.startTime) || tsToDate(titular.endTime);
  if (d) return d;
  return new Date();
}

export function extensionEndTimestamp(anchor: Date, hm: string): Timestamp {
  return hhmmPairToTimestamps(anchor, hm, hm).start;
}

export function adjustedStartTimestamp(anchor: Date, hm: string): Timestamp {
  return hhmmPairToTimestamps(anchor, hm, hm).start;
}

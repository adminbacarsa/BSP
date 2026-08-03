const DEFAULT_ORIGIN = 'https://comtroldata.web.app';

export function credencialPublicVerifyUrl(empDocId: string): string {
  const origin =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_PORTAL_WEB_ORIGIN?.trim()) ||
    DEFAULT_ORIGIN;
  const base = origin.replace(/\/$/, '');
  return `${base}/credencial/?id=${encodeURIComponent(empDocId)}`;
}

export function computeCredencialVerificationCode(empDocId: string, nowMs = Date.now()): {
  code: string;
  remainingSec: number;
  pct: number;
} {
  const now = Math.floor(nowMs / 1000);
  const w = Math.floor(now / 60);
  const rem = 60 - (now % 60);
  let h = 5381;
  const s = empDocId + ':' + w;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  const n = (Math.abs(h) % 1000000).toString().padStart(6, '0');
  return {
    code: `${n.slice(0, 3)} ${n.slice(3)}`,
    remainingSec: rem,
    pct: (rem / 60) * 100,
  };
}

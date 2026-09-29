const EMPTY = new Set(['', 'undefined', 'null']);

function token(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || EMPTY.has(s.toLowerCase())) return '';
  return s.split(/\s+/).filter(Boolean)[0] || '';
}

function capitalizeName(raw: string): string {
  const lower = raw.toLocaleLowerCase('es-AR');
  return lower.charAt(0).toLocaleUpperCase('es-AR') + lower.slice(1);
}

/** Primer nombre: firstName, o lo que sigue a la coma en «APELLIDO, Nombre Segundo». */
export function guardFirstName(input?: {
  firstName?: unknown;
  employeeName?: unknown;
} | null): string {
  if (!input) return '';
  const direct = token(input.firstName);
  if (direct) return capitalizeName(direct);
  const full = String(input.employeeName ?? '').trim();
  if (!full || EMPTY.has(full.toLowerCase())) return '';
  const comma = full.indexOf(',');
  const given = comma >= 0 ? full.slice(comma + 1) : full;
  const first = token(given);
  return first ? capitalizeName(first) : '';
}

export function guardLead(name: string, sentence: string): string {
  const text = sentence.trim();
  if (!name) return text;
  return `${name}, ${text}`;
}

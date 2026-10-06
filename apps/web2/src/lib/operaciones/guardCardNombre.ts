/**
 * Nombre de la tarjeta del CC: el apellido no se parte.
 * «BAEZ, Augusto Damian» y «BAEZ Augusto Damian» → apellido BAEZ + resto.
 */
export function partesNombreTarjeta(name: string | null | undefined): {
  apellido: string;
  resto: string;
  completo: string;
} {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { apellido: '—', resto: '', completo: '—' };
  const coma = raw.indexOf(',');
  const completo = coma > 0
    ? [raw.slice(0, coma).trim(), raw.slice(coma + 1).trim()].filter(Boolean).join(' ')
    : raw;
  const parts = completo.split(' ');
  return { apellido: parts[0] || completo, resto: parts.slice(1).join(' '), completo };
}

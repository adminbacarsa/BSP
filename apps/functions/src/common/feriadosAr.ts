/**
 * Copia de isArgentineHoliday (apps/web2/src/lib/servicios/slaHoursCalculator.ts): Functions no importa web2.
 * Si se agrega un feriado allá, agregarlo acá.
 */
// ─── FERIADOS NACIONALES ARGENTINA ────────────────────────────────────────────
// Fuente: Decreto PEN. Incluye fijos, móviles y trasladables 2024-2027.
// Los feriados puente por decreto anual deben agregarse a esta lista cuando se conozcan.

/** Feriados de fecha fija (MM-DD) que aplican todos los años. */
const AR_FERIADOS_FIJOS = new Set([
  '01-01', // Año Nuevo
  '03-24', // Día Nacional de la Memoria
  '04-02', // Veteranos y Caídos en Malvinas
  '05-01', // Día del Trabajador
  '05-25', // Revolución de Mayo
  '06-20', // Paso a la Inmortalidad del Gral. Belgrano (Día de la Bandera)
  '07-09', // Día de la Independencia
  '12-08', // Inmaculada Concepción de María
  '12-25', // Navidad
]);

/** Feriados variables y trasladables por año (YYYY-MM-DD). */
const AR_FERIADOS_VARIABLES: Record<string, string[]> = {
  '2024': [
    '2024-02-12', '2024-02-13', // Carnaval
    '2024-03-29',               // Viernes Santo
    '2024-04-01',               // Feriado puente
    '2024-06-21',               // Feriado puente
    '2024-08-19',               // San Martín (trasladado, 17/8 era sábado)
    '2024-10-11',               // Diversidad Cultural (trasladado)
    '2024-11-18',               // Soberanía Nacional (trasladado)
  ],
  '2025': [
    '2025-03-03', '2025-03-04', // Carnaval
    '2025-03-24',               // (ya incluido en fijos)
    '2025-04-18',               // Viernes Santo
    '2025-05-02',               // Feriado puente
    '2025-08-15',               // Feriado puente
    '2025-08-18',               // San Martín (trasladado, 17/8 era domingo)
    '2025-10-13',               // Diversidad Cultural (trasladado, 12/10 era domingo)
    '2025-11-21',               // Feriado puente
    '2025-11-24',               // Soberanía Nacional
  ],
  '2026': [
    '2026-02-16', '2026-02-17', // Carnaval
    '2026-04-03',               // Viernes Santo (Pascua 5/4/2026)
    '2026-08-17',               // San Martín (17/8 es lunes, no se traslada)
    '2026-10-12',               // Diversidad Cultural (12/10 es lunes, no se traslada)
    '2026-11-23',               // Soberanía Nacional (cuarto lunes de noviembre)
  ],
  '2027': [
    '2027-02-08', '2027-02-09', // Carnaval
    '2027-03-26',               // Viernes Santo (Pascua 28/3/2027)
    '2027-06-21',               // Güemes (trasladado, 17/6 era jueves)
    '2027-08-16',               // San Martín (trasladado, 17/8 era martes)
    '2027-10-11',               // Diversidad Cultural (trasladado, 12/10 era martes)
    '2027-11-20',               // Soberanía Nacional (20/11 es sábado, queda)
  ],
};

/**
 * Retorna true si la fecha dada (YYYY-MM-DD) es feriado nacional argentino.
 * No incluye feriados puente decretados ad-hoc que no estén en la lista.
 */
export function isArgentineHoliday(dateStr: string): boolean {
  const norm = (dateStr || '').trim().slice(0, 10);
  if (norm.length < 10) return false;
  const mmdd = norm.slice(5); // MM-DD
  if (AR_FERIADOS_FIJOS.has(mmdd)) return true;
  const year = norm.slice(0, 4);
  return (AR_FERIADOS_VARIABLES[year] ?? []).includes(norm);
}

/** Franja del SLA con «+ feriados» que corre ese día por ser feriado. */
export function bandaCorreFeriado(band: unknown, dateStr: string): boolean {
  return (band as { feriados?: unknown } | null)?.feriados === true && isArgentineHoliday(dateStr);
}

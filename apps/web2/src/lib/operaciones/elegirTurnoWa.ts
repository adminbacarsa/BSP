/**
 * Elige a qué fila de Modo Rápido va un mensaje de WhatsApp cuando el guardia
 * tiene más de un turno o tramo hoy (turno cortado, dos franjas, etc.).
 *
 * Fuente de verdad: el número de teléfono en RRHH. El nombre/apodo del contacto
 * en el celular (pushName) no decide el match.
 */

export type TurnoWaMatch = {
  rowId: string;
  phone?: string;
  name?: string;
  turnoStatus?: string;
  startTimeRaw?: unknown;
  endTimeRaw?: unknown;
  /** OPERATIONS_COVERAGE: la fichada WA debe ir al puesto que cubre, no a su RET/origen. */
  origin?: string;
};

/** Ventana de ingreso: no se toma como llegada un mensaje más de 30 min antes del inicio. */
export const WA_VENTANA_INGRESO_MS = 30 * 60 * 1000;

export function msDeRawWa(raw: unknown): number {
  if (!raw) return 0;
  const r = raw as { toMillis?: () => number; seconds?: number };
  if (typeof r.toMillis === 'function') return r.toMillis();
  if (typeof r.seconds === 'number') return r.seconds * 1000;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' || raw instanceof Date) {
    const t = new Date(raw as string | Date).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

function normPhone(phone?: string | null): string {
  return String(phone || '')
    .replace(/\D/g, '')
    .replace(/^549/, '');
}

function statusOf(t: TurnoWaMatch): string {
  return String(t.turnoStatus || 'PENDING').toUpperCase();
}

/** Tokens de nombre ≥ 4 letras, sin tildes (uso opcional / pantallas manuales). */
export function tokensNombreWa(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

export function nombresCompatiblesWa(pushName: string, employeeName: string): boolean {
  const a = tokensNombreWa(pushName);
  const b = new Set(tokensNombreWa(employeeName));
  if (!a.length || !b.size) return true;
  return a.some((t) => b.has(t));
}

/**
 * Solo por teléfono. El apodo del contacto en WhatsApp no filtra.
 * `permitirNombre` solo para pantallas manuales; el automático no lo usa.
 */
export function candidatosTurnoWa(
  turnos: readonly TurnoWaMatch[],
  name: string,
  phone?: string | null,
  opts?: { permitirNombre?: boolean },
): TurnoWaMatch[] {
  const np = normPhone(phone);
  if (np) {
    const byPhone = turnos.filter((t) => t.phone && normPhone(t.phone) === np);
    if (byPhone.length) return byPhone;
  }
  if (!opts?.permitirNombre) return [];
  const pushName = (name || '').toLowerCase().trim();
  if (!pushName) return [];
  return turnos.filter((t) => {
    const kk = String(t.name || '').toLowerCase();
    if (!kk) return false;
    return pushName.includes(kk) || kk.includes(pushName);
  });
}

/**
 * Entre candidatos ya filtrados: primero PRESENTE con fin vencido (salida); si no,
 * PRESENTE en curso; recién después PENDING aún abierto.
 */
export function elegirEntreCandidatosWa(
  candidatos: readonly TurnoWaMatch[],
  msgMs?: number,
): TurnoWaMatch | undefined {
  if (!candidatos.length) return undefined;
  const msg = msgMs && msgMs > 0 ? msgMs : Date.now();

  const presentes = candidatos.filter((t) => statusOf(t) === 'PRESENT');
  if (presentes.length) {
    const paraSalir = presentes
      .filter((t) => {
        const fin = msDeRawWa(t.endTimeRaw);
        return fin > 0 && msg >= fin;
      })
      .sort((a, b) => msDeRawWa(b.endTimeRaw) - msDeRawWa(a.endTimeRaw));
    if (paraSalir[0]) return paraSalir[0];

    const enCurso = presentes.filter((t) => {
      const start = msDeRawWa(t.startTimeRaw);
      const fin = msDeRawWa(t.endTimeRaw);
      return start > 0 && fin > 0 && msg >= start && msg < fin;
    });
    if (enCurso[0]) return enCurso[0];
    return presentes[0];
  }

  const pendientes = candidatos
    .filter((t) => {
      const st = statusOf(t);
      if (st === 'COMPLETED' || st === 'CANCELED' || st === 'CANCELLED' || st === 'ABSENT') {
        return false;
      }
      const fin = msDeRawWa(t.endTimeRaw);
      if (fin > 0 && msg >= fin) return false;
      return true;
    })
    .sort((a, b) => {
      // Quien cubre debe fichar en el puesto de cobertura, no en su franco/RET origen.
      const cov = (t: TurnoWaMatch) =>
        String(t.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE' ? 0 : 1;
      const byCov = cov(a) - cov(b);
      if (byCov !== 0) return byCov;
      return msDeRawWa(a.startTimeRaw) - msDeRawWa(b.startTimeRaw);
    });
  return pendientes[0];
}

/**
 * Match por teléfono. Entre tramos del mismo número: salida del presente vencido,
 * luego presente en curso, luego pendiente abierto.
 */
export function elegirTurnoWa(
  turnos: readonly TurnoWaMatch[],
  name: string,
  phone?: string | null,
  msgMs?: number,
  opts?: { permitirNombre?: boolean },
): TurnoWaMatch | undefined {
  return elegirEntreCandidatosWa(candidatosTurnoWa(turnos, name, phone, opts), msgMs);
}

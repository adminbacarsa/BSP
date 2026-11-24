/**
 * Elige a qué fila de Modo Rápido va un mensaje de WhatsApp cuando el guardia
 * tiene más de un turno o tramo hoy (turno cortado, dos franjas, etc.).
 */

export type TurnoWaMatch = {
  rowId: string;
  phone?: string;
  name?: string;
  turnoStatus?: string;
  startTimeRaw?: unknown;
  endTimeRaw?: unknown;
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

/** Tokens de nombre ≥ 4 letras, sin tildes, para comparar pushName vs legajo. */
export function tokensNombreWa(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

/**
 * El pushName de WhatsApp y el nombre del legajo deben compartir al menos un token.
 * Evita cerrar el turno de Nahuel cuando manda Franco, aunque el teléfono en RRHH esté mal.
 */
export function nombresCompatiblesWa(pushName: string, employeeName: string): boolean {
  const a = tokensNombreWa(pushName);
  const b = new Set(tokensNombreWa(employeeName));
  if (!a.length || !b.size) return true;
  return a.some((t) => b.has(t));
}

/**
 * Solo por teléfono. El match por nombre fuzzy cerraba turnos ajenos (Franco → Nahuel).
 * `permitirNombre` queda por si hace falta en pantallas manuales; el automático no lo usa.
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
    if (byPhone.length) {
      return byPhone.filter((t) => nombresCompatiblesWa(name, String(t.name || '')));
    }
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
 * Entre los turnos del mismo guardia: primero el que está PRESENTE y ya terminó
 * (salida); si no, el PRESENTE en curso; recién después un PENDING dentro de la
 * ventana de ingreso. Así la ubicación de egreso del tramo 1 no marca el tramo 2.
 */
export function elegirTurnoWa(
  turnos: readonly TurnoWaMatch[],
  name: string,
  phone?: string | null,
  msgMs?: number,
  opts?: { permitirNombre?: boolean },
): TurnoWaMatch | undefined {
  const candidatos = candidatosTurnoWa(turnos, name, phone, opts);
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

  // PENDING aunque falte más de 30 min: la planilla responde al guardia y no confirma.
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
    .sort((a, b) => msDeRawWa(a.startTimeRaw) - msDeRawWa(b.startTimeRaw));
  return pendientes[0];
}

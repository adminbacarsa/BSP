/**
 * Cerebro de Planificación — Tipos compartidos entre dominios.
 * Los tipos aquí son independientes de VPLAN y del motor V2;
 * cada función del cerebro los usa como contrato de entrada/salida.
 */

// ─── SLA de entrada ──────────────────────────────────────────────────────────

export interface CerebroShift {
  code: string;           // M, T, N, D12, N12, EN, RO, etc.
  name: string;
  hours: number;
  startTime: string;      // HH:MM
  endTime: string;        // HH:MM
  days?: string[];        // Si difiere de activeDays del puesto
  specificDates?: string[]; // YYYY-MM-DD para refuerzos puntuales
}

export interface CerebroPosition {
  id: string;
  name: string;
  coverageType: '24hs' | '12hs_diurno' | '12hs_nocturno' | 'custom';
  quantity: number;           // Guardias simultáneos requeridos
  shifts: CerebroShift[];
  activeDays: string[];       // ['L','M','X','J','V','S','D']
  excludedDates?: string[];   // YYYY-MM-DD sin servicio solo en este puesto
  operaFeriados?: boolean;    // Si cubre días feriados (undefined = sí por defecto)
}

export interface CerebroSLA {
  id: string;
  objectiveId: string;
  objectiveName?: string;
  clientId: string;
  positions: CerebroPosition[];
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  totalMonthlyHours?: number;
  excludedDates?: string[];   // Días sin servicio global (aplica a todos los puestos)
}

// ─── Tipos de salida de Inteligencia de Servicio ─────────────────────────────

/** Una necesidad concreta de cobertura: puesto + banda + cantidad + horario */
export interface CoverageNeed {
  puestoId: string;
  puestoName: string;
  banda: string;            // Código: M, T, N, D12, N12, etc.
  bandaName: string;
  cantSimultaneos: number;
  diasSemana: string[];     // ['L','M','X','J','V','S','D'] o subconjunto
  horaInicio: string;       // HH:MM
  horaFin: string;          // HH:MM
  hours: number;
  esBanda12h: boolean;
  excludedDates: string[];
}

/** Masa crítica: cuántos empleados mínimos se necesitan por banda para el ciclo */
export interface MasaCritica {
  banda: string;
  cantSimultaneos: number;
  empleadosMinimos: number;
  ciclo: { diasTrabajo: number; cicloDias: number };
  empleadosActuales?: number;
  enDeficit: boolean;
  faltante?: number;
}

/** Estado actual del servicio: ¿hay cronograma generado o es un servicio nuevo? */
export interface EstadoServicio {
  esNuevo: boolean;
  turnosExistentes: number;
  empleadosAsignados: string[];
  posicionesCubiertas: string[];
  ultimaFechaGeneracion?: string; // YYYY-MM-DD
}

/** Información sobre bandas de 12h presentes en el SLA */
export interface BandaEspecialInfo {
  esBanda12h: boolean;
  bandas12h: string[];
  cicloAdaptado: { diasTrabajo: number; cicloDias: number };
  maxDiasConsecutivos: number;  // 3 para 12h, 6 para 8h (CCT)
  notas: string[];
}

/** Cobertura proyectada para cada feriado del año */
export interface CoberturaFeriado {
  fecha: string;              // YYYY-MM-DD
  nombreFeriado: string;
  requiereCobertura: boolean;
  tipoCodigo: 'FF' | 'normal'; // FF si trabaja en el feriado
  esFeriadoNacional: boolean;
  esFeriadoProvincial: boolean;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

export const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
export type DiaSemana = typeof DIAS_SEMANA[number];

export const BANDAS_8H = ['M', 'T', 'N', 'ESC', 'REF', 'RET'] as const;
export const BANDAS_12H = ['D12', 'N12'] as const;

export const CICLO_ESTANDAR = { diasTrabajo: 6, cicloDias: 8 } as const;
export const CICLO_12H = { diasTrabajo: 4, cicloDias: 6 } as const;

/** Horarios por defecto de cada banda estándar */
export const HORARIOS_BANDA: Record<string, { startTime: string; endTime: string; hours: number; name: string }> = {
  M:   { startTime: '06:00', endTime: '14:00', hours: 8,  name: 'Mañana' },
  T:   { startTime: '14:00', endTime: '22:00', hours: 8,  name: 'Tarde' },
  N:   { startTime: '22:00', endTime: '06:00', hours: 8,  name: 'Noche' },
  D12: { startTime: '07:00', endTime: '19:00', hours: 12, name: 'Diurno 12h' },
  N12: { startTime: '19:00', endTime: '07:00', hours: 12, name: 'Nocturno 12h' },
};

// ─── Normalización desde Firestore ───────────────────────────────────────────

/**
 * Convierte un documento de `servicios_sla` (raw Firestore) a `CerebroSLA`.
 * Maneja tanto `allowedShiftTypes` (campo web) como `shifts` (campo normalizado).
 */
export function normalizarSlaDeFirestore(doc: Record<string, any>): CerebroSLA {
  const positions: CerebroPosition[] = (doc.positions ?? []).map((p: any) => {
    const rawShifts: any[] = p.allowedShiftTypes ?? p.shifts ?? [];
    const shifts: CerebroShift[] = rawShifts.map((s: any) => ({
      code: s.code ?? '',
      name: s.name ?? s.code ?? '',
      hours: Number(s.hours ?? 8),
      startTime: s.startTime ?? '06:00',
      endTime: s.endTime ?? '14:00',
      days: s.days,
      specificDates: s.specificDates,
    }));
    return {
      id: p.id ?? p.name ?? '',
      name: p.name ?? p.id ?? '',
      coverageType: p.coverageType ?? '24hs',
      quantity: Number(p.quantity ?? 1),
      shifts,
      activeDays: p.activeDays ?? [...DIAS_SEMANA],
      excludedDates: p.excludedDates,
      operaFeriados: p.operaFeriados,
    };
  });

  return {
    id: doc.id ?? '',
    objectiveId: doc.objectiveId ?? '',
    objectiveName: doc.objectiveName,
    clientId: doc.clientId ?? '',
    positions,
    startDate: doc.startDate ?? '',
    endDate: doc.endDate ?? '',
    totalMonthlyHours: doc.totalMonthlyHours,
    excludedDates: doc.excludedDates,
  };
}

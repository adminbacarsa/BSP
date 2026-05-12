import { LaborAgreement } from '../interfaces/employee.interface';

export interface LaborRule {
    name: string;
    maxHoursWeekly?: number;      // Límite semanal (ej: 48hs)
    maxHoursMonthly: number;      // Límite mensual referencial
    overtimeThresholdDaily?: number; // A partir de qué hora diaria es extra (ej: 9hs o 12hs)
    saturdayCutoffHour: number;   // Hora corte sábado para el 100% (ej: 13:00)
    nightShiftStart: number;      // Hora inicio nocturnidad (21:00)
    nightShiftEnd: number;        // Hora fin nocturnidad (06:00)
}

// DEFINICIÓN DE CONVENIOS
export const LABOR_RULES: Record<LaborAgreement, LaborRule> = {
    'SUVICO': {
        name: 'Seguridad Privada (CCT 422/05)',
        maxHoursWeekly: 48,
        maxHoursMonthly: 204, // Divisor estándar convenio
        overtimeThresholdDaily: 12, // Se permiten jornadas de 12h sin extra si no pasa las 48h sem
        saturdayCutoffHour: 13,
        nightShiftStart: 21,
        nightShiftEnd: 6
    },
    'COMERCIO': {
        name: 'Empleados de Comercio',
        maxHoursWeekly: 48,
        maxHoursMonthly: 196,
        overtimeThresholdDaily: 9, // Jornada de 9h
        saturdayCutoffHour: 13,
        nightShiftStart: 21,
        nightShiftEnd: 6
    },
    'UOCRA': {
        name: 'Construcción',
        maxHoursWeekly: 44,
        maxHoursMonthly: 176,
        overtimeThresholdDaily: 9,
        saturdayCutoffHour: 13,
        nightShiftStart: 20,
        nightShiftEnd: 6
    },
    'FUERA_CONVENIO': {
        name: 'Personal Jerárquico',
        maxHoursWeekly: 999, // Sin límite estricto de horas extra
        maxHoursMonthly: 999,
        overtimeThresholdDaily: 24,
        saturdayCutoffHour: 24,
        nightShiftStart: 22,
        nightShiftEnd: 6
    }
};




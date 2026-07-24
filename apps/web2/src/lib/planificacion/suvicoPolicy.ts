/**
 * Matriz de referencia normativa SUVICO (CCT 422/05) + parámetros que usa el motor V2,
 * verificación y fixer. Valores numéricos de descanso/topes son la fuente única de verdad
 * para `restBetweenShifts`, `coverageVerification`, `coverageFixer` y `generateScheduleV2`.
 *
 * Licencias detalladas (fallecimiento, matrimonio, etc.) documentan plazos calendario;
 * el modelo de ausencias en Firestore sigue usando códigos agregados (V/L/E/…): cuando RRHH
 * incorpore subtipos, mapearlos aquí y en `absenceCodes.ts`.
 */

export const SUVICO_POLICY = {
    REST: {
        /** Descanso mínimo entre fin de un turno e inicio del siguiente (interjornada). */
        DAILY_MIN_HOURS: 8,
        /** Horas trabajadas en racha (con interjornadas de 12h entre medias) que disparan el descanso prolongado. */
        STREAK_HOURS_FOR_LONG_REST: 48,
        /** Equivalente operativo: 6 turnos × 8 h (M/T/N) o 4 turnos × 12 h (D12/N12). */
        STREAK_SHIFTS_8H: 6,
        STREAK_SHIFTS_12H: 4,
        /**
         * Descanso mínimo tras cumplir la racha de `STREAK_HOURS_FOR_LONG_REST` (horas reales
         * entre fin del último turno de la racha e inicio del siguiente). Equivale a la fórmula
         * (24 − H_salida) + 24 + H_entrada ≥ 35 en esquemas de doble franco / cierre de ciclo.
         */
        WEEKLY_MIN_REST_AFTER_STREAK_HOURS: 35,
        /** Objetivo mensual informativo (no tope duro del motor por sí solo). */
        TARGET_MONTHLY: 192,
        /** Tope duro de horas facturables por ciclo CCT (26→25). */
        MAX_MONTHLY_HARD: 200,
        /**
         * Referencia CCT: jornada máxima típica por bloque. No recorta horas en el motor ni en
         * asignaciones persistidas: la liquidación sigue el mismo criterio que siempre (campo `hours`,
         * start/end, lookups). Una capa aparte (avisos / RRHH) puede usar este valor si hace falta.
         */
        MAX_SINGLE_SHIFT_HOURS: 12,
    },
    /**
     * Umbrales de alerta post-generación (suma ISO-semana de horas facturables en `writeAssignment`).
     * No sustituyen `checkRestBetweenShifts`; sirven para costo/carga.
     */
    ALERTS: {
        WEEK_BILLABLE_HOURS_DEFAULT: 48,
        /** Tope semanal con extensión 12h (contingencia: 4×8 + 2×12 = 56h). */
        MAX_WEEKLY_BILLABLE_HOURS_WITH_EXTENSION: 56,
        /** Puestos L–V u otros no 24×7 con jornadas largas estructurales (ej. 5×10h → 50h/semana). */
        WEEK_BILLABLE_HOURS_LIMITED_POSITION: 50,
        /** Sugerencias post-grilla: priorizar “gastar” RET entre quienes llevan menos horas facturables en el mes. */
        LOW_BILLABLE_HOURS_FOR_RET_PRIORITY: 160,
        /**
         * Proyección calendario 2026 (tabla comparativa): aviso antes del tope CCT cuando
         * un esquema típico acumularía muchas horas en ese mes (p. ej. 4+2 ~180h hacia día 20).
         */
        MONTHLY_BILLABLE_SOFT_WARN_HOURS: 180,
    },
    /** Días corridos de licencia especial (referencia convenio; validación documental en RRHH). */
    LEAVES_DAYS: {
        DEATH_DIRECT: 4,
        DEATH_EXTENDED: 2,
        DEATH_INDIRECT: 1,
        BIRTH: 3,
        MARRIAGE: 10,
        MOVE: 2,
        BLOOD_DONATION: 1,
    },
    STUDY: {
        DAYS_PER_EXAM: 2,
        ANNUAL_MAX_DAYS: 10,
        NOTICE_HOURS: 48,
    },
    /** Límites de licencia por enfermedad/accidente (meses de goce); Art. 208 LCT + convenio. */
    SICK_LEAVE_MONTHS_PAID: {
        UNDER_5_YEARS: { withoutDependents: 3, withDependents: 6 },
        FROM_5_YEARS: { withoutDependents: 6, withDependents: 12 },
    },
    /** Tras vencimiento de licencia pagada: reserva de puesto sin goce (referencia 12 meses). */
    SICK_LEAVE_RESERVE_WITHOUT_PAY_MONTHS: 12,
    VACATION: {
        /** Para período completo: debe haberse trabajado la mitad de los días hábiles del año (regla de oro). */
        REQUIRES_HALF_WORKABLE_YEAR_FOR_FULL_BUCKET: true,
        /** Si no cumple, 1 día de vacaciones por cada N días trabajados (proporcional). */
        PRO_RATA_ONE_DAY_PER_WORKED_DAYS: 20,
        /** Días corridos según antigüedad al 31/12 (años exclusivos en el techo). */
        DAYS_BY_SENIORITY_YEARS: [
            { maxYearsExclusive: 5, calendarDays: 14 },
            { maxYearsExclusive: 10, calendarDays: 21 },
            { maxYearsExclusive: 20, calendarDays: 28 },
            { maxYearsExclusive: 999, calendarDays: 35 },
        ],
    },
    /**
     * Matriz de costos / prioridades para evolución del motor (recargos, suplementarias).
     * Los porcentajes son referencia liquidación — el motor aún no asigna por “costo doble” automático.
     */
    COST: {
        SATURDAY_AFTER_13H_SURCHARGE_PCT: 100,
        SUNDAY_SURCHARGE_PCT: 100,
        NATIONAL_HOLIDAY_SURCHARGE_PCT: 100,
        NIGHT_WINDOW: { startHour: 21, endHourExclusive: 6 },
        SUPPLEMENTARY_OVER_MONTHLY_TARGET_PCT: 50,
    },
} as const;

export type SuvicoPolicy = typeof SUVICO_POLICY;

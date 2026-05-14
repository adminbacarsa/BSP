/**
 * Semántica operativa de códigos de celda (planificación / grilla).
 * Los horarios por defecto se alinean con `restBetweenShifts` y `coverageVerification`
 * cuando la celda no trae `startTime`/`endTime` propios del SLA.
 */

/** Retén pasivo: no suma horas facturables hasta que operaciones lo active. */
export const RET_BILLABLE_HOURS = 0;

export const SHIFT_PROTOCOL = {
    EN: {
        label: 'Encargada/Admin',
        defaultHours: 9,
        /** Cobertura típica administrativa; el puesto puede acotar `activeDays` en el SLA. */
        typicalActiveDays: ['L', 'M', 'X', 'J', 'V'] as const,
    },
    M: { label: 'Mañana', defaultHours: 8, defaultStart: '06:00', defaultEnd: '14:00' },
    T: { label: 'Tarde', defaultHours: 8, defaultStart: '14:00', defaultEnd: '22:00' },
    N: { label: 'Noche', defaultHours: 8, defaultStart: '22:00', defaultEnd: '06:00' },
    D12: { label: 'Diurno 12h', defaultHours: 12, defaultStart: '07:00', defaultEnd: '19:00' },
    N12: { label: 'Nocturno 12h', defaultHours: 12, defaultStart: '19:00', defaultEnd: '07:00' },
    RET: { label: 'Retención pasiva', defaultHours: RET_BILLABLE_HOURS },
    F: { label: 'Franco', defaultHours: 0 },
} as const;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LABOR_RULES = void 0;
exports.LABOR_RULES = {
    'SUVICO': {
        name: 'Seguridad Privada (CCT 422/05)',
        maxHoursWeekly: 48,
        maxHoursMonthly: 204,
        overtimeThresholdDaily: 12,
        saturdayCutoffHour: 13,
        nightShiftStart: 21,
        nightShiftEnd: 6
    },
    'COMERCIO': {
        name: 'Empleados de Comercio',
        maxHoursWeekly: 48,
        maxHoursMonthly: 196,
        overtimeThresholdDaily: 9,
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
        maxHoursWeekly: 999,
        maxHoursMonthly: 999,
        overtimeThresholdDaily: 24,
        saturdayCutoffHour: 24,
        nightShiftStart: 22,
        nightShiftEnd: 6
    }
};
//# sourceMappingURL=labor-rules.js.map
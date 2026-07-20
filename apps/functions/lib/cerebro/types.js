"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HORARIOS_BANDA = exports.CICLO_12H = exports.CICLO_ESTANDAR = exports.BANDAS_12H = exports.BANDAS_8H = exports.DIAS_SEMANA = void 0;
exports.normalizarSlaDeFirestore = normalizarSlaDeFirestore;
exports.DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
exports.BANDAS_8H = ['M', 'T', 'N', 'ESC', 'REF', 'RET'];
exports.BANDAS_12H = ['D12', 'N12'];
exports.CICLO_ESTANDAR = { diasTrabajo: 6, cicloDias: 8 };
exports.CICLO_12H = { diasTrabajo: 4, cicloDias: 6 };
exports.HORARIOS_BANDA = {
    M: { startTime: '06:00', endTime: '14:00', hours: 8, name: 'Mañana' },
    T: { startTime: '14:00', endTime: '22:00', hours: 8, name: 'Tarde' },
    N: { startTime: '22:00', endTime: '06:00', hours: 8, name: 'Noche' },
    D12: { startTime: '07:00', endTime: '19:00', hours: 12, name: 'Diurno 12h' },
    N12: { startTime: '19:00', endTime: '07:00', hours: 12, name: 'Nocturno 12h' },
};
function normalizarSlaDeFirestore(doc) {
    const positions = (doc.positions ?? []).map((p) => {
        const rawShifts = p.allowedShiftTypes ?? p.shifts ?? [];
        const shifts = rawShifts.map((s) => ({
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
            activeDays: p.activeDays ?? [...exports.DIAS_SEMANA],
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
//# sourceMappingURL=types.js.map
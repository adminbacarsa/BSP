"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VPLAN_SHIFT_HOURS_BY_CODE = exports.VPLAN_WORK_BLOCK_HOURS_STRETCH = exports.VPLAN_WORK_BLOCK_HOURS_STANDARD = exports.VPLAN_FRANCO_REST_HOURS = exports.VPLAN_MIN_REST_HOURS_BETWEEN_TURNS = void 0;
exports.shiftHoursForTurnCode = shiftHoursForTurnCode;
exports.isEightHourTurnCode = isEightHourTurnCode;
exports.isTwelveHourTurnCode = isTwelveHourTurnCode;
exports.sumTurnSequenceHours = sumTurnSequenceHours;
exports.isValidWorkBlockHours = isValidWorkBlockHours;
exports.buildShiftTypeCatalog = buildShiftTypeCatalog;
exports.buildDailyCoverageEquivalence = buildDailyCoverageEquivalence;
exports.buildBlockPatternsForCycle = buildBlockPatternsForCycle;
exports.isBillableWorkTurnCode = isBillableWorkTurnCode;
exports.isFrancoRestCode = isFrancoRestCode;
exports.isFrancoTrabajadoCode = isFrancoTrabajadoCode;
exports.getVplanCycleDefinition = getVplanCycleDefinition;
exports.buildVplanCycleSemantics = buildVplanCycleSemantics;
exports.formatEmployeeTurnStreakLabel = formatEmployeeTurnStreakLabel;
const planning_rules_defaults_1 = require("../planning/planning-rules.defaults");
const planning_rules_service_1 = require("../planning/planning-rules.service");
exports.VPLAN_MIN_REST_HOURS_BETWEEN_TURNS = 12;
exports.VPLAN_FRANCO_REST_HOURS = 24;
exports.VPLAN_WORK_BLOCK_HOURS_STANDARD = 48;
exports.VPLAN_WORK_BLOCK_HOURS_STRETCH = 56;
exports.VPLAN_SHIFT_HOURS_BY_CODE = {
    M: 8,
    T: 8,
    N: 8,
    D12: 12,
    N12: 12,
    EN: 9,
    RO: 10,
    ESC: 8,
    REF: 8,
    FT: 8,
};
const EIGHT_HOUR_TURNS = new Set(['M', 'T', 'N']);
const TWELVE_HOUR_TURNS = new Set(['D12', 'N12']);
const CYCLE_PATTERN_EXAMPLES = {
    '6+2': 'M M M M M M F F',
    '4+2': 'D12 D12 D12 D12 F F',
    '5+1': 'M M M M M F',
    '6+1': 'M M M M M M F',
};
const CYCLE_BLOCK_PATTERNS = [
    {
        id: '6x2_8h',
        cycleKey: '6+2',
        label: '6+2 estándar (8h)',
        pattern: 'M M M M M M F F',
        turnHours: [8, 8, 8, 8, 8, 8],
        totalWorkHours: 48,
        restFrancos: 2,
        valid: true,
        note: '6 turnos × 8h = 48h → 2 francos (24h c/u). Ciclo normal del objetivo.',
    },
    {
        id: '4x2_12h',
        cycleKey: '4+2',
        label: '4+2 lógico (12h)',
        pattern: 'D12 D12 D12 D12 F F',
        turnHours: [12, 12, 12, 12],
        totalWorkHours: 48,
        restFrancos: 2,
        valid: true,
        note: '4 turnos × 12h = 48h → 2F. Equivalente al bloque 6×8, NO son 6 turnos de 12h.',
    },
    {
        id: 'stretch_56h',
        cycleKey: '6+2',
        label: 'Extensión 56h (contingencia)',
        pattern: 'M M M M D12 D12 F F',
        turnHours: [8, 8, 8, 8, 12, 12],
        totalWorkHours: 56,
        restFrancos: 2,
        valid: true,
        note: '4×8 + 2×12 = 56h. Estiramiento excepcional hasta tope operativo — no es 6+2 puro.',
    },
    {
        id: 'invalid_6x12',
        cycleKey: '4+2',
        label: '❌ Inválido: 6 turnos 12h',
        pattern: 'D12 D12 D12 D12 D12 D12 F F',
        turnHours: [12, 12, 12, 12, 12, 12],
        totalWorkHours: 72,
        restFrancos: 2,
        valid: false,
        note: '6×12 = 72h — supera 48h y 56h. Imposible como bloque legal/operativo.',
    },
];
function shiftHoursForTurnCode(code) {
    const c = String(code || '').toUpperCase();
    return exports.VPLAN_SHIFT_HOURS_BY_CODE[c] ?? 0;
}
function isEightHourTurnCode(code) {
    return EIGHT_HOUR_TURNS.has(String(code || '').toUpperCase());
}
function isTwelveHourTurnCode(code) {
    return TWELVE_HOUR_TURNS.has(String(code || '').toUpperCase());
}
function sumTurnSequenceHours(codes) {
    return codes.reduce((s, c) => s + shiftHoursForTurnCode(c), 0);
}
function isValidWorkBlockHours(totalHours, rules) {
    const resolved = (0, planning_rules_service_1.resolvePlanningRules)(rules ?? null);
    const standard = exports.VPLAN_WORK_BLOCK_HOURS_STANDARD;
    const stretch = resolved.maxConsecutiveWorkHours ?? exports.VPLAN_WORK_BLOCK_HOURS_STRETCH;
    if (totalHours <= standard) {
        return { ok: true, level: 'standard', message: `${totalHours}h ≤ ${standard}h (bloque CCT estándar)` };
    }
    if (totalHours <= stretch) {
        return { ok: true, level: 'stretch', message: `${totalHours}h — extensión/contingencia (≤ ${stretch}h)` };
    }
    return { ok: false, level: 'invalid', message: `${totalHours}h > ${stretch}h — bloque inválido` };
}
function buildShiftTypeCatalog() {
    return [
        {
            group: '8h',
            codes: ['M', 'T', 'N'],
            hoursEach: 8,
            label: 'Turnos 8 horas (M / T / N)',
            dailyCoverageNote: '3 turnos/día (M+T+N) = 24h de cobertura diaria',
        },
        {
            group: '12h',
            codes: ['D12', 'N12'],
            hoursEach: 12,
            label: 'Turnos 12 horas (D12 / N12)',
            dailyCoverageNote: '2 turnos/día (D12+N12) = 24h de cobertura diaria',
        },
    ];
}
function buildDailyCoverageEquivalence() {
    return {
        hoursPerDay: 24,
        formula8h: '3 × 8h = M + T + N = 24h',
        formula12h: '2 × 12h = D12 + N12 = 24h',
        summary: 'Un día de puesto 24hs se cierra con triplete M+T+N (8h) o pareja D12+N12 (12h).',
    };
}
function buildBlockPatternsForCycle(cycleKey, rules) {
    const stretch = (0, planning_rules_service_1.resolvePlanningRules)(rules ?? null).maxConsecutiveWorkHours
        ?? exports.VPLAN_WORK_BLOCK_HOURS_STRETCH;
    return CYCLE_BLOCK_PATTERNS
        .filter((p) => p.cycleKey === cycleKey || p.id === 'stretch_56h' || p.id === 'invalid_6x12')
        .map((p) => ({
        id: p.id,
        label: p.label,
        pattern: p.pattern,
        totalWorkHours: p.totalWorkHours,
        hoursFormula: p.turnHours.map((h) => `${h}h`).join(' + ')
            + ` = ${p.totalWorkHours}h`,
        restFrancos: p.restFrancos,
        valid: p.valid,
        note: p.id === 'stretch_56h'
            ? p.note.replace('56', String(stretch))
            : p.note,
    }));
}
function isBillableWorkTurnCode(code, cycle) {
    const c = String(code || '').toUpperCase();
    if (!c || ['F', 'FF', 'FP', 'FT', 'RET', 'R', 'NR'].includes(c))
        return false;
    if (['V', 'L', 'E', 'A', 'PG', 'AA'].includes(c))
        return false;
    const key = (0, planning_rules_defaults_1.normalizePlanningCycleKey)(cycle);
    if (key === '4+2')
        return c === 'D12' || c === 'N12';
    return ['M', 'T', 'N', 'EN', 'RO', 'RON', 'D12', 'N12', 'ESC', 'REF'].includes(c);
}
function isFrancoRestCode(code) {
    const c = String(code || '').toUpperCase();
    return c === 'F' || c === 'FF' || c === 'FP';
}
function isFrancoTrabajadoCode(code) {
    return String(code || '').toUpperCase() === 'FT';
}
function getVplanCycleDefinition(cycle, rules) {
    const resolved = (0, planning_rules_service_1.resolvePlanningRules)(rules ?? null);
    const key = (0, planning_rules_defaults_1.normalizePlanningCycleKey)(cycle);
    const workTurnCount = (0, planning_rules_defaults_1.workDaysForCycle)(key, resolved);
    const restFrancoCount = (0, planning_rules_defaults_1.restDaysForCycle)(key, resolved);
    const patternExample = CYCLE_PATTERN_EXAMPLES[key]
        ?? `${'T '.repeat(workTurnCount).trim()} ${'F '.repeat(restFrancoCount).trim()}`.trim();
    const hoursPerTurn = key === '4+2' ? 12 : 8;
    const workBlockHours = workTurnCount * hoursPerTurn;
    const hoursFormula = `${workTurnCount} × ${hoursPerTurn}h = ${workBlockHours}h`;
    return {
        cycleKey: key,
        workTurnCount,
        restFrancoCount,
        francoHours: exports.VPLAN_FRANCO_REST_HOURS,
        minRestHoursBetweenTurns: exports.VPLAN_MIN_REST_HOURS_BETWEEN_TURNS,
        patternExample,
        unitLabel: 'turnos + francos (24h)',
        notCalendarDays: `No son ${workTurnCount} días calendario: son ${workTurnCount} turnos de ${hoursPerTurn}h, `
            + `luego ${restFrancoCount} francos de ${exports.VPLAN_FRANCO_REST_HOURS}h (${hoursFormula} antes del descanso).`,
        shiftHours: resolved.cycles[key]?.shiftHours ?? (key === '4+2' ? 12 : 8),
        workBlockHours,
        hoursFormula,
        standardBlockHours: exports.VPLAN_WORK_BLOCK_HOURS_STANDARD,
        stretchBlockHours: resolved.maxConsecutiveWorkHours ?? exports.VPLAN_WORK_BLOCK_HOURS_STRETCH,
    };
}
function buildVplanCycleSemantics(cycle, rules) {
    const cycleDef = getVplanCycleDefinition(cycle, rules);
    const key = cycleDef.cycleKey;
    return {
        headline: 'Turnos 8h (M/T/N) o 12h (D12/N12). Bloque = 48h (6×8 = 4×12). 12h entre turnos — inviolable.',
        inviolableRules: [
            {
                id: 'REST_12H',
                priority: 0,
                label: '12h entre turnos',
                rule: 'Un guardia NO puede iniciar un turno si no transcurrieron al menos 12 horas '
                    + 'desde el fin del turno anterior (M/T/N/D12/N12). Sin excepciones en planificación base.',
            },
            {
                id: 'FRANCO_24H',
                priority: 1,
                label: 'Franco = 24h',
                rule: 'F = 24 horas de descanso. No es un “día libre” abstracto.',
            },
            {
                id: 'BLOCK_48H',
                priority: 2,
                label: 'Bloque 48h antes de 2F',
                rule: key === '4+2'
                    ? '4+2 = 4 turnos × 12h = 48h (D12 D12 D12 D12 F F). Nunca 6 turnos de 12h (72h).'
                    : '6+2 = 6 turnos × 8h = 48h (M M M M M M F F). Equivalente a 4×12h.',
            },
        ],
        shiftTypes: buildShiftTypeCatalog(),
        dailyCoverageEquivalence: buildDailyCoverageEquivalence(),
        blockPatterns: buildBlockPatternsForCycle(key, rules),
        cycleDefinition: cycleDef,
        cycleVsCoverage: {
            cycleLabel: `${cycleDef.workTurnCount} turnos × ${cycleDef.shiftHours}h = ${cycleDef.workBlockHours}h → ${cycleDef.restFrancoCount}F`,
            coverageLabel: 'Por día/puesto: M+T+N (3×8h) o D12+N12 (2×12h) = 24h',
            relationship: 'Cobertura = cuántos turnos por puesto/día. Ciclo del guardia = cuántas horas acumula '
                + `(48h estándar, hasta ${cycleDef.stretchBlockHours}h en extensión) antes de 2 francos de 24h. `
                + 'Son capas distintas.',
        },
        planningOrder: [
            { order: 1, key: 'REST_12H', label: '12h entre turnos' },
            { order: 2, key: 'BLOCK_HOURS', label: `Bloque ≤ ${cycleDef.workBlockHours}h (${cycleDef.hoursFormula})` },
            { order: 3, key: 'CYCLE_TURNS', label: `${cycleDef.patternExample}` },
            { order: 4, key: 'TRAILING', label: 'Racha turnos mes anterior' },
            { order: 5, key: 'COVERAGE', label: 'Slots SLA (M+T+N / día)' },
            { order: 6, key: 'HOURS', label: 'Horas vendidas mes' },
        ],
    };
}
function formatEmployeeTurnStreakLabel(workTurns, restFrancos) {
    if (restFrancos > 0)
        return `Fx${restFrancos} (${restFrancos} franco(s) 24h)`;
    if (workTurns > 0)
        return `Tx${workTurns} (${workTurns} turno(s) sin F)`;
    return '—';
}
//# sourceMappingURL=vplan.cycle-semantics.js.map
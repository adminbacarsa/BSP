"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVplanPlanningMethod = buildVplanPlanningMethod;
const vplan_brain_model_1 = require("./vplan.brain-model");
const vplan_rotation_1 = require("./vplan.rotation");
const vplan_positions_1 = require("./vplan.positions");
function buildMandates(cycleSemantics) {
    const cycleDef = cycleSemantics?.cycleDefinition;
    const work = cycleDef?.workTurnCount ?? 6;
    const rest = cycleDef?.restFrancoCount ?? 2;
    const pattern = cycleDef?.patternExample ?? 'M M M M M M F F';
    return [
        {
            order: 0,
            key: 'REST_12H',
            label: '12h entre turnos (INVIOLABLE)',
            rule: 'Ningún guardia puede iniciar un turno sin 12h de descanso desde el fin del anterior.',
        },
        {
            order: 1,
            key: 'CYCLE_TURNS',
            label: `Ciclo ${cycleDef?.cycleKey ?? '6+2'} = turnos + francos`,
            rule: `${work} turnos + ${rest} francos (24h c/u). Patrón: ${pattern}. `
                + 'NO son días calendario: F = 24h de descanso.',
        },
        {
            order: 2,
            key: 'COBERTURA_OBJETIVO',
            label: 'Cobertura SLA',
            rule: 'Cerrar slots del manifiesto (qty × banda × día). Sin exceso. Solo después de REST_12H y ciclo.',
        },
        {
            order: 3,
            key: 'HORAS_VENDIDAS',
            label: 'Horas vendidas',
            rule: 'Facturable del mes = slaVendidas. Redistribuir, no inventar turnos.',
        },
        {
            order: 4,
            key: 'TRAILING',
            label: 'Continuidad mes anterior',
            rule: 'Modo CONTINUE: la racha es de TURNOS (TxN / FxN), no de días calendario. Heredar junio → julio.',
        },
    ];
}
function buildPipelineSteps(mode, engine) {
    return [
        {
            step: 1,
            phase: '4_strategy',
            title: 'Elegir motor y ciclo',
            description: `Motor ${engine} · modo ${mode}. Definir trailing, continuidad y timing de ausencias.`,
        },
        {
            step: 2,
            phase: '5_generate',
            title: 'Grilla base + CCT',
            description: 'Motor genera celdas empleado×día. Enforce 6+2, custom L–V (RO/EN), apertura de mes.',
        },
        {
            step: 3,
            phase: '5_cover',
            title: 'Cierre slot a slot',
            description: 'Recorrer manifiesto de turnos/slot. Asignar guardia legal por fecha×puesto×banda.',
        },
        {
            step: 4,
            phase: '5_ladder',
            title: 'Escalera de cobertura',
            description: 'Si falta slot: subgrupo 6+2 → 4+2 → sin turno → RET → FT (último recurso).',
        },
        {
            step: 5,
            phase: '7_verify',
            title: 'Verificar',
            description: '418/418 slots, horas SLA, descansos 12h, rachas, sin sobre-cobertura.',
        },
        {
            step: 6,
            phase: '8_fix',
            title: 'Fixer CCT (si aplica)',
            description: 'Reparación determinística sin romper cobertura ya cerrada.',
        },
    ];
}
function buildPositionAssignmentRules(positions, cycle) {
    const rot = (0, vplan_rotation_1.getRotationProfile)(cycle);
    return positions.map((pos) => {
        if ((0, vplan_positions_1.is24hsPosition)(pos)) {
            const qty = Math.max(1, pos.qty);
            const headcount = rot.subgroupSize * qty;
            return {
                positionName: pos.positionName,
                assignmentMode: '24hs_rotativo',
                qty,
                headline: `${qty} pax · subgrupo ${rot.subgroupSize} guardias/pax`,
                description: `Por cada día activo: ${qty}×M + ${qty}×T + ${qty}×N. `
                    + `${headcount} guardias rotan ${rot.workersPerDay} trab + ${rot.francosPerDay}F/día. `
                    + `Banda fija por titular + flotante rota para cerrar triplete.`,
            };
        }
        const codes = (pos.shifts || []).map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
        return {
            positionName: pos.positionName,
            assignmentMode: 'custom_fijo',
            qty: Math.max(1, pos.qty),
            headline: `Custom ${codes.join('/')} · L–V`,
            description: `Puesto fijo: ${codes.join(' o ')} en días hábiles. Fines de semana sin slot SLA. `
                + `Titular del puesto cubre; si falta → escalera desde mismo objetivo.`,
        };
    });
}
function buildVplanPlanningMethod(opts) {
    const { strategy } = opts;
    const rot = (0, vplan_rotation_1.getRotationProfile)(strategy.cycle);
    const mandates = buildMandates(opts.cycleSemantics);
    const pipelineSteps = buildPipelineSteps(opts.mode, strategy.engine);
    const positionRules = buildPositionAssignmentRules(opts.positions, strategy.cycle);
    const coverageLadder = vplan_brain_model_1.COVERAGE_LADDER.map((step) => {
        let when = 'Preferido — no rompe ciclo 6+2';
        if ('breaks6x2' in step && step.breaks6x2) {
            when = 'Último recurso — genera costo extra (FT)';
        }
        else if ('requiresHourHeadroom' in step && step.requiresHourHeadroom) {
            when = 'Solo si hay headroom de horas vs SLA';
        }
        return {
            step: step.step,
            key: step.key,
            label: step.label,
            when,
        };
    });
    const layers = [
        {
            key: 'CICLO_OBJETIVO',
            label: 'Ciclo objetivo',
            value: `${strategy.cycle} · ${rot.workBlockDays}+${rot.restBlockDays}`,
            notes: `${rot.shiftHours}h/turno · ${rot.bandsPerDay} bandas/día · subgrupo ${rot.subgroupSize}`,
        },
        {
            key: 'CONTINGENCIA_4X2',
            label: 'Contingencia 4+2',
            value: opts.feasibility?.capacityAdequate ? 'Disponible si headroom' : 'Evaluar dotación',
            notes: 'D12/N12 12h — mismo bloque 48h, otro régimen. Escalón 2 de cobertura.',
        },
        {
            key: 'OFFSET_RACHA',
            label: 'Offset racha (trailing)',
            value: strategy.modes.useTrailing
                ? `${opts.trailingEmployeeCount ?? 0} guardias con racha junio`
                : 'Sin trailing (GREENFIELD)',
            notes: strategy.modes.useTrailing
                ? 'Apertura día 1 del mes = continuación del 6+2 previo'
                : 'Arranque en frío — todos empiezan ciclo nuevo',
        },
    ];
    const totalSlots = opts.demand?.coverageManifest?.totalRequiredSlots
        ?? opts.demand?.planningTarget?.totalMonthlySlots
        ?? 0;
    const guardias = opts.supply?.employeeCount ?? opts.feasibility?.peopleAvailable ?? 0;
    const headline = opts.cycleSemantics?.headline
        ?? 'Ciclo = turnos + francos (24h). 12h entre turnos — inviolable.';
    const summaryParts = [
        `${strategy.engine}`,
        `ciclo ${strategy.cycle}`,
        strategy.modes.useTrailing ? 'CONTINUE con racha' : 'sin racha',
        totalSlots > 0 ? `${totalSlots} slots a cerrar` : null,
        guardias > 0 ? `${guardias} guardias` : null,
    ].filter(Boolean);
    const summary = summaryParts.join(' · ');
    return {
        headline,
        summary,
        engine: strategy.engine,
        cycle: strategy.cycle,
        mode: opts.mode,
        mandates,
        layers,
        pipelineSteps,
        positionRules,
        coverageLadder,
        rotationProfile: {
            subgroupSize: rot.subgroupSize,
            workersPerDay: rot.workersPerDay,
            francosPerDay: rot.francosPerDay,
            shiftHours: rot.shiftHours,
            workBlockDays: rot.workBlockDays,
            restBlockDays: rot.restBlockDays,
        },
        strategyNotes: strategy.notes,
    };
}
//# sourceMappingURL=vplan.planning-method.js.map
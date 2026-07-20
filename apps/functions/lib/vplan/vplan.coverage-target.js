"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_NAMES = exports.ALL_DAYS = void 0;
exports.formatBandSlotsLabel = formatBandSlotsLabel;
exports.formatActiveDaysLabel = formatActiveDaysLabel;
exports.formatDayDemandSummary = formatDayDemandSummary;
exports.sortPositionPlanningRules = sortPositionPlanningRules;
exports.buildVplanPlanningTarget = buildVplanPlanningTarget;
exports.dailyTripletLabel = dailyTripletLabel;
const vplan_positions_1 = require("./vplan.positions");
function formatBandSlotsLabel(bandSlots) {
    const entries = Object.entries(bandSlots).filter(([, n]) => n > 0);
    if (entries.length === 0)
        return '—';
    return entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, n]) => `${n}×${code}`)
        .join(' + ');
}
const DAY_NAMES = {
    L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb', D: 'Dom',
};
exports.DAY_NAMES = DAY_NAMES;
const ALL_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
exports.ALL_DAYS = ALL_DAYS;
function formatActiveDaysLabel(activeDays) {
    if (!activeDays || activeDays.length === 0 || activeDays.length >= 7) {
        return 'L–D (todos los días)';
    }
    if (activeDays.length === 5
        && ['L', 'M', 'X', 'J', 'V'].every((d) => activeDays.includes(d))
        && !activeDays.includes('S')
        && !activeDays.includes('D')) {
        return 'L–V (lun a vie)';
    }
    return activeDays.map((d) => DAY_NAMES[d] ?? d).join(', ');
}
function formatDayDemandSummary(day) {
    const parts = day.positions.map((p) => `${p.positionName}: ${formatBandSlotsLabel(p.bandSlots)}`);
    const bands = Object.entries(day.positions.reduce((acc, p) => {
        for (const [code, n] of Object.entries(p.bandSlots)) {
            acc[code] = (acc[code] || 0) + n;
        }
        return acc;
    }, {}))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([c, n]) => `${n}×${c}`)
        .join(' + ');
    return `${day.totalPaxUnits} pax · ${bands || 'sin bandas'} (${day.hoursRequired}h)${parts.length ? ` — ${parts.join(' · ')}` : ''}`;
}
function countSlotsInDayPositions(positions) {
    return positions.reduce((s, p) => s + Object.values(p.bandSlots).reduce((a, b) => a + b, 0), 0);
}
function buildMonthlyFormulaLabel(opts) {
    const monthlyBands = formatBandSlotsLabel(opts.monthlySlotsByBand);
    return `${opts.activeDayCount} días × (${opts.dailyBandsLabel}) = ${monthlyBands} = ${opts.monthlyTotalSlots} turnos/slot`;
}
function buildSlotArithmeticLine(rule) {
    const monthlyBands = formatBandSlotsLabel(rule.monthlySlotsByBand);
    return `${rule.positionName} · Qty ${rule.qty} = ${rule.dailyBandsLabel} · ${rule.activeDayCount} días = ${monthlyBands} = ${rule.monthlyTotalSlots} turnos/slot`;
}
function buildMonthBandRollup(rules) {
    const byBand = new Map();
    for (const rule of rules) {
        for (const [band, count] of Object.entries(rule.monthlySlotsByBand)) {
            if (count <= 0)
                continue;
            const existing = byBand.get(band) ?? { band, total: 0, parts: [], label: '' };
            existing.total += count;
            existing.parts.push({ positionName: rule.positionName, count });
            byBand.set(band, existing);
        }
    }
    return [...byBand.values()]
        .sort((a, b) => a.band.localeCompare(b.band))
        .map((entry) => {
        const partsLabel = entry.parts
            .map((p) => `${p.count} ${p.positionName}`)
            .join(' + ');
        entry.label = `${entry.total}×${entry.band} = ${partsLabel}`;
        return entry;
    });
}
function buildTotalFormulaLabel(rules, total) {
    if (!rules.length)
        return `0 turnos/slot`;
    const sum = rules.map((r) => r.monthlyTotalSlots).join(' + ');
    return `${sum} = ${total} turnos/slot`;
}
function dayExampleFromDemand(day, label) {
    const positions = day.positions.map((p) => ({
        positionName: p.positionName,
        qty: p.qty,
        bandSlots: p.bandSlots,
        hoursRequired: p.hoursRequired,
        requirementLabel: formatBandSlotsLabel(p.bandSlots),
    }));
    return {
        label,
        dateStr: day.dateStr,
        dayLetter: day.dayLetter,
        positions,
        totalSlots: countSlotsInDayPositions(day.positions),
        totalHours: day.hoursRequired,
        summaryLabel: formatDayDemandSummary(day),
    };
}
function buildPositionRules(positions, dayDemands, cycle) {
    return positions.map((pos) => {
        const activeDays = (0, vplan_positions_1.resolveActiveDays)(pos);
        const activeDayCount = dayDemands.filter((d) => d.positions.some((p) => p.positionName === pos.positionName)).length;
        const sampleDay = dayDemands.find((d) => d.positions.some((p) => p.positionName === pos.positionName));
        const samplePos = sampleDay?.positions.find((p) => p.positionName === pos.positionName);
        let dailyRequirementLabel = '—';
        let dailyBandsLabel = '—';
        let slotsPerActiveDay = 0;
        let dailyHours = 0;
        let schemeLabel = 'custom';
        if (samplePos) {
            dailyBandsLabel = formatBandSlotsLabel(samplePos.bandSlots);
            dailyRequirementLabel = formatBandSlotsLabel(samplePos.bandSlots);
            slotsPerActiveDay = Object.values(samplePos.bandSlots).reduce((a, b) => a + b, 0);
            dailyHours = samplePos.hoursRequired;
            schemeLabel = samplePos.schemeLabel;
        }
        else {
            const codes = (0, vplan_positions_1.is24hsPosition)(pos)
                ? (0, vplan_positions_1.shiftsForCycle)(pos, cycle).map((s) => String(s.code || '').toUpperCase()).filter(Boolean)
                : (pos.shifts || []).map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
            const bandSlots = {};
            for (const code of codes) {
                bandSlots[code] = Math.max(1, pos.qty);
            }
            dailyRequirementLabel = formatBandSlotsLabel(bandSlots);
            dailyBandsLabel = dailyRequirementLabel;
            slotsPerActiveDay = Object.values(bandSlots).reduce((a, b) => a + b, 0);
            dailyHours = codes.reduce((h, code) => {
                const sh = (pos.shifts || []).find((s) => String(s.code || '').toUpperCase() === code);
                return h + Math.max(1, pos.qty) * (0, vplan_positions_1.shiftBandHours)(sh || { code });
            }, 0);
            schemeLabel = (0, vplan_positions_1.is24hsPosition)(pos) ? 'M+T+N' : codes.join('+');
        }
        const monthlySlotsByBand = {};
        let monthlyTotalSlots = 0;
        for (const day of dayDemands) {
            const pd = day.positions.find((p) => p.positionName === pos.positionName);
            if (!pd)
                continue;
            for (const [code, n] of Object.entries(pd.bandSlots)) {
                monthlySlotsByBand[code] = (monthlySlotsByBand[code] || 0) + n;
                monthlyTotalSlots += n;
            }
        }
        const qtyNote = pos.qty > 1
            ? `${pos.qty} pax → ${dailyBandsLabel}`
            : `1 pax → ${dailyBandsLabel}`;
        const monthlyFormulaLabel = buildMonthlyFormulaLabel({
            activeDayCount,
            dailyBandsLabel,
            monthlySlotsByBand,
            monthlyTotalSlots,
        });
        return {
            positionName: pos.positionName,
            qty: Math.max(1, pos.qty),
            coverageType: (0, vplan_positions_1.is24hsPosition)(pos) ? '24hs' : String(pos.coverageType || 'custom'),
            schemeLabel,
            activeDaysLabel: formatActiveDaysLabel(activeDays),
            dailyBandsLabel,
            dailyRequirementLabel: qtyNote,
            slotsPerActiveDay,
            dailyHours,
            monthlySlotsByBand,
            monthlyTotalSlots,
            activeDayCount,
            monthlyFormulaLabel,
        };
    });
}
function buildDayTypeExamples(dayDemands) {
    const examples = [];
    const used = new Set();
    const pick = (predicate, label) => {
        const day = dayDemands.find((d) => predicate(d) && !used.has(d.dateStr));
        if (!day)
            return;
        used.add(day.dateStr);
        examples.push(dayExampleFromDemand(day, label));
    };
    pick((d) => d.positions.length >= 3 && !['S', 'D'].includes(d.dayLetter), 'Día hábil completo (24hs + custom L–V)');
    pick((d) => ['S', 'D'].includes(d.dayLetter) && d.positions.some((p) => p.schemeLabel === 'M+T+N'), 'Fin de semana (solo puestos 24hs M+T+N)');
    pick((d) => d.positions.length === 1 && (d.positions[0]?.bandSlots.RO ?? 0) > 0, 'Día custom (solo rondín)');
    if (examples.length === 0 && dayDemands[0]) {
        examples.push(dayExampleFromDemand(dayDemands[0], 'Primer día del mes'));
    }
    return examples;
}
function sortPositionPlanningRules(rules) {
    const sortKey = (r) => {
        const puestoNum = r.positionName.match(/puesto\s*(\d+)/i);
        if (r.coverageType === '24hs' && puestoNum) {
            return parseInt(puestoNum[1], 10);
        }
        if ((r.monthlySlotsByBand.RO ?? 0) > 0 || r.schemeLabel === 'RO')
            return 900;
        if ((r.monthlySlotsByBand.EN ?? 0) > 0 || r.schemeLabel === 'EN')
            return 901;
        if (r.coverageType === '24hs')
            return 500;
        return 950;
    };
    return [...rules].sort((a, b) => {
        const ka = sortKey(a);
        const kb = sortKey(b);
        if (ka !== kb)
            return ka - kb;
        return a.positionName.localeCompare(b.positionName, 'es');
    });
}
function buildVplanPlanningTarget(opts) {
    const positionRules = sortPositionPlanningRules(buildPositionRules(opts.positions, opts.dayDemands, opts.cycle));
    const totalMonthlySlots = positionRules.reduce((s, r) => s + r.monthlyTotalSlots, 0);
    const dayTypeExamples = buildDayTypeExamples(opts.dayDemands);
    const slotArithmeticLines = positionRules.map(buildSlotArithmeticLine);
    const totalFormulaLabel = buildTotalFormulaLabel(positionRules, totalMonthlySlots);
    const monthBandRollup = buildMonthBandRollup(positionRules);
    const bandSummary = Object.entries(opts.monthBandDemand)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, n]) => `${n}×${code}`)
        .join(' · ');
    const headline = 'Por cada día activo: qty × banda por puesto. Total mes = Σ (días activos × bandas/día).';
    const summary = `${totalFormulaLabel} · ${Math.round(opts.monthDemandHours)}h estructura · ${bandSummary}`;
    return {
        headline,
        summary,
        totalMonthlySlots,
        totalMonthlyHours: Math.round(opts.monthDemandHours),
        monthBandDemand: opts.monthBandDemand,
        positionRules,
        dayTypeExamples,
        slotArithmeticLines,
        totalFormulaLabel,
        monthBandRollup,
    };
}
function dailyTripletLabel(qty) {
    if (qty <= 0)
        return '—';
    if (qty === 1)
        return '1×M + 1×T + 1×N';
    return `${qty}×M + ${qty}×T + ${qty}×N`;
}
//# sourceMappingURL=vplan.coverage-target.js.map
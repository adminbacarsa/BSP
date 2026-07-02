/**
 * Fase 1 VPLAN — modelo de demanda (SLA → puestos × bandas × días).
 * Lógica adaptada de objectiveCoverageDemand.ts (web2), sin importar legacy.
 */

import type { VplanDemandModel, VplanDayDemand, VplanPositionDemand } from '../vplan.types';
import type { VplanPositionDef } from '../vplan.positions';
import { is24hsPosition, isPositionActiveOnDay, shiftBandHours } from '../vplan.positions';

function bandSetsForPosition(pos: VplanPositionDef): { bands8: string[]; bands12: string[] } {
  const bands8 = [...new Set(
    pos.shifts.filter((s) => shiftBandHours(s) < 12).map((s) => s.code).filter(Boolean),
  )];
  const bands12 = [...new Set(
    pos.shifts.filter((s) => shiftBandHours(s) >= 12).map((s) => s.code).filter(Boolean),
  )];
  return { bands8, bands12 };
}

function schemeLabelFromBands(bands: Record<string, number>): string {
  const keys = Object.keys(bands).sort();
  if (keys.length === 3 && keys.includes('M') && keys.includes('T') && keys.includes('N')) return 'M+T+N';
  if (keys.includes('D12') && keys.includes('N12')) return 'D12+N12';
  return keys.join('+') || 'custom';
}

function buildBandSlotsForPositionDay(
  pos: VplanPositionDef,
  dayLetter: string,
): { bandSlots: Record<string, number>; hours: number; schemeLabel: string } {
  const qty = Math.max(1, pos.qty);
  if (is24hsPosition(pos)) {
    const { bands8, bands12 } = bandSetsForPosition(pos);
    const mtn = bands8.length > 0 ? bands8 : ['M', 'T', 'N'];
    const bandSlots: Record<string, number> = {};
    for (const b of mtn) bandSlots[b] = qty;
    return { bandSlots, hours: qty * 24, schemeLabel: schemeLabelFromBands(bandSlots) };
  }

  const bands = pos.shifts.map((s) => s.code).filter(Boolean);
  const bandSlots: Record<string, number> = {};
  let hours = 0;
  for (const b of bands) {
    bandSlots[b] = qty;
    const sh = pos.shifts.find((s) => s.code === b);
    hours += qty * shiftBandHours(sh || { code: b });
  }
  return {
    bandSlots,
    hours: hours || qty * 8,
    schemeLabel: schemeLabelFromBands(bandSlots),
  };
}

export function buildVplanDemandModel(opts: {
  positions: VplanPositionDef[];
  days: Array<{ dateStr: string; dayLetter: string }>;
  slaVendidas: number;
}): VplanDemandModel {
  const dayDemands: VplanDayDemand[] = opts.days.map(({ dateStr, dayLetter }) => {
    const positions: VplanPositionDemand[] = [];
    let totalPaxUnits = 0;
    let hoursRequired = 0;

    for (const pos of opts.positions) {
      if (!isPositionActiveOnDay(pos, dayLetter)) continue;
      const built = buildBandSlotsForPositionDay(pos, dayLetter);
      positions.push({
        positionName: pos.positionName,
        qty: pos.qty,
        coverageType: pos.coverageType,
        schemeLabel: built.schemeLabel,
        bandSlots: built.bandSlots,
        hoursRequired: built.hours,
      });
      totalPaxUnits += pos.qty;
      hoursRequired += built.hours;
    }

    return { dateStr, dayLetter, positions, totalPaxUnits, hoursRequired };
  });

  const monthDemandHours = dayDemands.reduce((s, d) => s + d.hoursRequired, 0);
  const slaVendidas = Math.max(0, opts.slaVendidas || 0);
  const hoursDelta = slaVendidas > 0 ? monthDemandHours - slaVendidas : 0;

  const monthBandDemand: Record<string, number> = {};
  for (const day of dayDemands) {
    for (const pos of day.positions) {
      for (const [code, n] of Object.entries(pos.bandSlots)) {
        monthBandDemand[code] = (monthBandDemand[code] || 0) + n;
      }
    }
  }

  const warnings: string[] = [];
  if (slaVendidas > 0 && Math.abs(hoursDelta) > 1) {
    warnings.push(
      hoursDelta > 0
        ? `Estructura SLA (${Math.round(monthDemandHours)}h) supera vendidas (${slaVendidas}h) en ${Math.round(hoursDelta)}h`
        : `Estructura SLA (${Math.round(monthDemandHours)}h) está ${Math.round(-hoursDelta)}h por debajo de vendidas (${slaVendidas}h)`,
    );
  }

  const peakDay = dayDemands.reduce((best, d) => (
    d.totalPaxUnits > (best?.totalPaxUnits ?? 0) ? d : best
  ), dayDemands[0]);
  if (peakDay && peakDay.totalPaxUnits > 0) {
    const slotCount = peakDay.positions.reduce((s, p) => (
      s + Object.values(p.bandSlots).reduce((a, b) => a + Number(b), 0)
    ), 0);
    warnings.push(`Día pico ${peakDay.dateStr}: ${peakDay.totalPaxUnits} pax · ${slotCount} slots banda`);
  }

  if (!opts.positions.length) {
    warnings.push('SLA sin puestos configurados');
  }

  return {
    slaVendidas,
    monthDemandHours,
    hoursDelta,
    dayDemands,
    monthBandDemand,
    warnings,
  };
}

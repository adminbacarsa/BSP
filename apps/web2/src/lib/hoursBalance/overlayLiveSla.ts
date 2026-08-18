import { type HoursBalanceRow, round1 } from './types';

/** Pisa el SLA del extracto con el contrato vigente. Conserva plan/real/fichadas. */
export function applyLiveSlaHoursToBalanceRows(
  rows: HoursBalanceRow[],
  liveSlaByObjective: Record<string, number>,
  metaByObjective?: Record<string, { clientId?: string; clientName?: string; objectiveName?: string }>,
): HoursBalanceRow[] {
  if (!liveSlaByObjective || !Object.keys(liveSlaByObjective).length) return rows;
  const seen = new Set(rows.map((r) => r.objectiveId));
  const out = rows.map((r) => {
    const live = liveSlaByObjective[r.objectiveId];
    if (live == null) return r;
    const slaHours = round1(live);
    return {
      ...r,
      slaHours,
      saldoPlan: round1(slaHours - r.plannedHours),
      saldoReal: round1(slaHours - r.realHours),
    };
  });
  const template = rows[0];
  Object.entries(liveSlaByObjective).forEach(([id, sla]) => {
    if (seen.has(id) || !(sla > 0) || !template) return;
    const meta = metaByObjective?.[id];
    const slaHours = round1(sla);
    out.push({
      empresaId: template.empresaId,
      objectiveId: id,
      objectiveName: meta?.objectiveName || id,
      clientId: meta?.clientId || '',
      clientName: meta?.clientName || '',
      year: template.year,
      month: template.month,
      periodKey: template.periodKey,
      slaHours,
      plannedHours: 0,
      vacantHours: 0,
      realHours: 0,
      ftHours: 0,
      extHours: 0,
      adelHours: 0,
      opsHours: 0,
      absenceHours: 0,
      resultante: 0,
      saldoPlan: slaHours,
      saldoReal: slaHours,
      rebuiltFrom: 'sla',
    });
  });
  return out;
}

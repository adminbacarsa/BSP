import type { WorkBand } from './employeeScheduleState';

export interface ServiceRequirement {
  bandsNeeded: WorkBand[];
  paxPerBand: number;
  cycleDays?: number;
  workDaysPerCycle?: number;
}

export interface RosterValidation {
  minRequired: number;
  actualRoster: number;
  deficit: number;
  avgWorking: number;
  avgPerBand: number;
  warning: string | null;
}

export function validateRosterSufficiency(
  req: ServiceRequirement,
  rosterSize: number,
): RosterValidation {
  const cycleDays = req.cycleDays ?? 8;
  const workDays = req.workDaysPerCycle ?? 6;
  const workRatio = workDays / cycleDays;
  const numBandas = req.bandsNeeded.length;
  const dailyNeed = req.paxPerBand * numBandas;
  const minRequired = Math.ceil(dailyNeed / workRatio);
  const deficit = Math.max(0, minRequired - rosterSize);
  const avgWorking = rosterSize * workRatio;
  const avgPerBand = avgWorking / numBandas;

  const warning = deficit > 0
    ? `Dotación insuficiente: necesitás ${minRequired}, tenés ${rosterSize} (déficit ${deficit}). Promedio ${avgPerBand.toFixed(2)}/banda, habrá días con cobertura incompleta.`
    : null;

  return { minRequired, actualRoster: rosterSize, deficit, avgWorking, avgPerBand, warning };
}

import type { WorkBand, EmployeeScheduleState } from './employeeScheduleState';
import { applyAssignment, type CompletedAssignment } from './employeeScheduleState';
import { canAssign, type ShiftProposal, type ConstraintViolation } from './cctConstraintEngine';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export interface EmployeeProjectionInput {
  empId: string;
  initialState: EmployeeScheduleState;
  assignedBand: WorkBand;
  staggerAdjustment: number;
  rotation: WorkBand[];
  cycleWorkDays?: number;
  cycleRestDays?: number;
  absences: Map<string, string>;
  shiftStartHour: Record<WorkBand, number>;
  shiftHours: Record<WorkBand, number>;
}

export interface DayProjection {
  dateStr: string;
  shiftCode: string;
  hours: number;
  band: WorkBand | null;
  source: 'cycle' | 'stagger' | 'absence' | 'ret' | 'ff';
  violation?: ConstraintViolation;
}

export interface EmployeeProjectionResult {
  empId: string;
  days: DayProjection[];
  finalState: EmployeeScheduleState;
  hoursT1: number;
  hoursT2: number;
  violations: ConstraintViolation[];
}

export interface MonthProjectionResult {
  byEmployee: Map<string, EmployeeProjectionResult>;
  coverageByDay: Map<string, Partial<Record<WorkBand, number>>>;
  deficits: Array<{ dateStr: string; band: WorkBand; have: number; need: number }>;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function buildProposal(
  empId: string,
  dateStr: string,
  band: WorkBand,
  shiftStartHour: Record<WorkBand, number>,
  shiftHours: Record<WorkBand, number>,
  objectiveId: string,
): ShiftProposal {
  const startH = shiftStartHour[band];
  const hours = shiftHours[band];
  const endH = startH + hours;
  const startTimeISO = `${dateStr}T${pad(startH)}:00:00-03:00`;
  const endTimeISO = endH >= 24
    ? `${addOneDay(dateStr)}T${pad(endH - 24)}:00:00-03:00`
    : `${dateStr}T${pad(endH)}:00:00-03:00`;
  return { empId, dateStr, shiftCode: band, hours, startTimeISO, endTimeISO, objectiveId, positionName: '' };
}

function nextBand(rotation: WorkBand[], current: WorkBand): WorkBand {
  const idx = rotation.indexOf(current);
  return rotation[(idx + 1) % rotation.length];
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────

export function projectCycleIntoMonth(
  inputs: EmployeeProjectionInput[],
  monthDays: string[],
  bandNeed: Partial<Record<WorkBand, number>>,
  cctCutoffDay = 25,
): MonthProjectionResult {
  const byEmployee = new Map<string, EmployeeProjectionResult>();
  const coverageByDay = new Map<string, Partial<Record<WorkBand, number>>>();
  for (const dateStr of monthDays) coverageByDay.set(dateStr, {});

  for (const input of inputs) {
    const { empId, initialState, assignedBand, staggerAdjustment, rotation, absences, shiftStartHour, shiftHours } = input;
    const cycleWorkDays = input.cycleWorkDays ?? 6;
    const cycleRestDays = input.cycleRestDays ?? 2;

    let state: EmployeeScheduleState = initialState;
    let currentBand: WorkBand = assignedBand;
    let staggerLeft = staggerAdjustment;
    let daysWorkedInBand: number;
    let ffDaysUsed: number;

    // Inicializar posición en el ciclo según el trailing del mes anterior
    if (initialState.trailingRestDays > 0 && initialState.trailingRestDays < cycleRestDays) {
      // Mitad de FF: ya hizo trailingRestDays días de franco, necesita más
      daysWorkedInBand = cycleWorkDays;
      // ffDaysUsed = qué día del bloque FF es HOY (1=primer, 2=segundo...)
      // ya hizo trailingRestDays días en octubre, hoy es el siguiente
      ffDaysUsed = initialState.trailingRestDays + 1;
    } else if (initialState.trailingRestDays >= cycleRestDays) {
      // FF completo: empieza el mes trabajando en la banda asignada
      daysWorkedInBand = 0;
      ffDaysUsed = 0;
    } else {
      // Viene trabajando
      daysWorkedInBand = initialState.trailingWorkDays;
      ffDaysUsed = 0;
    }

    const days: DayProjection[] = [];
    const hardViolations: ConstraintViolation[] = [];

    for (const dateStr of monthDays) {
      // ── A: Ausencia ────────────────────────────────────────────────────────
      if (absences.has(dateStr)) {
        days.push({ dateStr, shiftCode: absences.get(dateStr)!, hours: 0, band: null, source: 'absence' });
        continue;
      }

      // ── B: En medio de FF ─────────────────────────────────────────────────
      if (ffDaysUsed > 0) {
        const shiftCode = ffDaysUsed === 1 ? 'F' : 'FF';
        days.push({ dateStr, shiftCode, hours: 0, band: null, source: 'ff' });
        const restAssignment: CompletedAssignment = {
          dateStr, shiftCode, hours: 0,
          startISO: `${dateStr}T00:00:00-03:00`,
          endISO: `${dateStr}T00:00:00-03:00`,
          objectiveId: '', positionName: '',
        };
        state = applyAssignment(state, restAssignment, cctCutoffDay);
        if (ffDaysUsed >= cycleRestDays) {
          currentBand = nextBand(rotation, currentBand);
          daysWorkedInBand = 0;
          ffDaysUsed = 0;
        } else {
          ffDaysUsed++;
        }
        continue;
      }

      // ── C: Días extra de stagger antes del FF ─────────────────────────────
      if (staggerLeft > 0 && daysWorkedInBand >= cycleWorkDays) {
        const proposal = buildProposal(empId, dateStr, currentBand, shiftStartHour, shiftHours, '');
        const hours = shiftHours[currentBand];
        const completed: CompletedAssignment = {
          dateStr, shiftCode: currentBand, hours,
          startISO: proposal.startTimeISO, endISO: proposal.endTimeISO,
          objectiveId: '', positionName: '',
        };
        days.push({ dateStr, shiftCode: currentBand, hours, band: currentBand, source: 'stagger' });
        state = applyAssignment(state, completed, cctCutoffDay);
        staggerLeft--;
        daysWorkedInBand++;
        continue;
      }

      // ── D: Inicio de FF ───────────────────────────────────────────────────
      if (daysWorkedInBand >= cycleWorkDays) {
        days.push({ dateStr, shiftCode: 'F', hours: 0, band: null, source: 'ff' });
        const restAssignment: CompletedAssignment = {
          dateStr, shiftCode: 'F', hours: 0,
          startISO: `${dateStr}T00:00:00-03:00`,
          endISO: `${dateStr}T00:00:00-03:00`,
          objectiveId: '', positionName: '',
        };
        state = applyAssignment(state, restAssignment, cctCutoffDay);
        if (cycleRestDays === 1) {
          currentBand = nextBand(rotation, currentBand);
          daysWorkedInBand = 0;
          ffDaysUsed = 0;
        } else {
          ffDaysUsed = 2; // 1 ya emitido (F); rama B emitirá el 2do (FF) con este valor
        }
        continue;
      }

      // ── E: Día normal de trabajo ───────────────────────────────────────────
      const proposal = buildProposal(empId, dateStr, currentBand, shiftStartHour, shiftHours, '');
      const verdict = canAssign(state, proposal, absences, cctCutoffDay);

      if (verdict.severity !== 'hard') {
        const hours = shiftHours[currentBand];
        const completed: CompletedAssignment = {
          dateStr, shiftCode: currentBand, hours,
          startISO: proposal.startTimeISO, endISO: proposal.endTimeISO,
          objectiveId: '', positionName: '',
        };
        const softViolation = verdict.severity === 'soft' ? verdict.violations[0] : undefined;
        days.push({
          dateStr, shiftCode: currentBand, hours, band: currentBand, source: 'cycle',
          ...(softViolation !== undefined && { violation: softViolation }),
        });
        state = applyAssignment(state, completed, cctCutoffDay);
        daysWorkedInBand++;
      } else {
        // Violación HARD → RET
        const retCompleted: CompletedAssignment = {
          dateStr, shiftCode: 'RET', hours: 0,
          startISO: proposal.startTimeISO, endISO: proposal.startTimeISO,
          objectiveId: '', positionName: '',
        };
        days.push({
          dateStr, shiftCode: 'RET', hours: 0, band: null, source: 'ret',
          violation: verdict.violations[0],
        });
        state = applyAssignment(state, retCompleted, cctCutoffDay);
        hardViolations.push(...verdict.violations);
        // daysWorkedInBand no avanza: RET no es trabajo de banda
      }
    }

    byEmployee.set(empId, {
      empId,
      days,
      finalState: state,
      hoursT1: state.hoursT1,
      hoursT2: state.hoursT2,
      violations: hardViolations,
    });

    // Acumular cobertura por día y banda
    for (const dp of days) {
      if ((dp.source === 'cycle' || dp.source === 'stagger') && dp.band !== null) {
        const dayCov = coverageByDay.get(dp.dateStr)!;
        dayCov[dp.band] = (dayCov[dp.band] ?? 0) + 1;
      }
    }
  }

  // Calcular déficits
  const deficits: Array<{ dateStr: string; band: WorkBand; have: number; need: number }> = [];
  for (const dateStr of monthDays) {
    const dayCov = coverageByDay.get(dateStr) ?? {};
    for (const [bandStr, need] of Object.entries(bandNeed)) {
      if (!need) continue;
      const band = bandStr as WorkBand;
      const have = dayCov[band] ?? 0;
      if (have < need) deficits.push({ dateStr, band, have, need });
    }
  }

  return { byEmployee, coverageByDay, deficits };
}

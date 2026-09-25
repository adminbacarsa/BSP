/**
 * Equivalencia clasificación Ops: legacy (pre-refactor) vs @cosp/ops-core.
 *   npm run eval:ops-core   (desde apps/web2 o raíz con script en package.json raíz)
 */
import { classifyOpsShift } from '@cosp/ops-core';
import {
  legacyClassifyOpsShift,
  LEGACY_CLASSIFY_KEYS,
} from './eval-ops-core-legacy-classify';

function d(y: number, m: number, day: number, h: number, min: number): Date {
  return new Date(y, m - 1, day, h, min, 0, 0);
}

function sec(date: Date): { seconds: number } {
  return { seconds: Math.floor(date.getTime() / 1000) };
}

type Fixture = {
  id: string;
  shift: Record<string, unknown>;
  now: Date;
  isValidEmployee: boolean;
  isFranco: boolean;
  shiftCode: string;
  effectiveEndDateObj?: Date | null;
  parentEmpleadoId?: string;
};

function buildFixtures(): Fixture[] {
  const baseStart = d(2026, 3, 15, 8, 0);
  const baseEnd = d(2026, 3, 15, 16, 0);
  const fixtures: Fixture[] = [];

  const push = (id: string, partial: Partial<Omit<Fixture, 'id'>> & { shift?: Record<string, unknown> }) => {
    const { shift: shiftOverride, ...rest } = partial;
    fixtures.push({
      id,
      now: d(2026, 3, 15, 8, 5),
      isValidEmployee: true,
      isFranco: false,
      shiftCode: 'M',
      shift: {
        shiftDateObj: baseStart,
        endDateObj: baseEnd,
        code: 'M',
        employeeId: 'emp1',
        ...shiftOverride,
      },
      ...rest,
    });
  };

  push('presente', {
    now: d(2026, 3, 15, 9, 0),
    shift: { isPresent: true, realStartTime: sec(d(2026, 3, 15, 8, 2)) },
  });

  push('ausente', {
    shift: { isAbsent: true },
  });

  push('vacante', {
    isValidEmployee: false,
    shift: { employeeId: null },
  });

  push('franco', {
    isFranco: true,
    shift: { isFranco: true, code: 'F' },
    shiftCode: 'F',
  });

  push('reten-pasivo', {
    shiftCode: 'RET',
    shift: { code: 'RET', isReten: true, origin: 'RETEN' },
  });

  push('retenido-campo', {
    now: d(2026, 3, 15, 17, 0),
    shift: {
      isPresent: true,
      isRetention: true,
      isCompleted: false,
      autoRetentionAt: sec(d(2026, 3, 15, 16, 5)),
    },
    effectiveEndDateObj: baseEnd,
  });

  push('cierre-pendiente', {
    now: d(2026, 3, 15, 16, 30),
    shift: { isPresent: true, isCompleted: false, isRetention: false },
    effectiveEndDateObj: baseEnd,
  });

  push('convocado-early', {
    now: d(2026, 3, 15, 7, 50),
    shift: { isEarlyStart: true, origin: 'OPERATIONS_COVERAGE' },
  });

  push('awaiting-checkin', {
    now: d(2026, 3, 15, 7, 55),
    shift: { isEarlyStart: true, origin: 'RETEN', isReten: true },
  });

  push('coverage-used', {
    shift: {
      coverageUsed: true,
      coverageUsedCoversEmployeeName: 'Pérez',
      coversEmployeeName: 'Pérez',
    },
  });

  push('descubierto-ratio', {
    isValidEmployee: false,
    now: d(2026, 3, 15, 12, 0),
    shift: { employeeId: null, isSinCobertura: false },
  });

  push('sin-cobertura-flag', {
    isValidEmployee: false,
    shift: { isSinCobertura: true },
  });

  push('rrhh-novedad', {
    shift: {
      hasNovedad: true,
      absenceId: 'abs1',
      absenceCreatedAt: d(2026, 3, 14, 8, 0).toISOString(),
      type: 'L',
    },
  });

  push('late-unnotified', {
    now: d(2026, 3, 15, 8, 20),
    shift: {},
  });

  push('late-notified', {
    now: d(2026, 3, 15, 8, 10),
    shift: {
      lateArrivalEtaMinutes: 15,
      lateArrivalEtaAt: sec(d(2026, 3, 15, 8, 25)),
    },
  });

  push('potential-absence-t30', {
    now: d(2026, 3, 15, 8, 35),
    shift: {},
  });

  push('ops-coverage-resolved', {
    shift: { origin: 'OPERATIONS_COVERAGE', resolvedBy: 'OPERACIONES' },
  });

  push('rfz-vacante', {
    isValidEmployee: false,
    shiftCode: 'RFZ',
    shift: { code: 'RFZ' },
  });

  push('tura-vacante', {
    isValidEmployee: false,
    shiftCode: 'TURA',
    shift: { code: 'TURA' },
  });

  push('planned-covered', {
    shift: {
      isAbsent: true,
      coverageStatus: 'COVERED',
      coverageSegmentRole: 'TARGET',
      coveredBy: 'García',
    },
  });

  push('extension-imminent', {
    now: d(2026, 3, 15, 15, 50),
    shift: {
      isExtended: true,
      coverageSegmentRole: 'EXTENSION',
      coveragePackageId: 'pkg1',
      segmentFromTime: '16:00',
    },
  });

  push('future-shift', {
    now: d(2026, 3, 15, 6, 0),
    shift: {},
  });

  push('imminent-window', {
    now: d(2026, 3, 15, 7, 50),
    shift: {},
  });

  push('present-outside-4h', {
    now: d(2026, 3, 15, 3, 0),
    shift: { isPresent: true },
  });

  push('sla-virtual-no-count', {
    shift: { origin: 'SLA_VIRTUAL', isPresent: false },
  });

  push('reported-planning-vacancy', {
    isValidEmployee: false,
    shift: { status: 'REPORTED_TO_PLANNING' },
  });

  return fixtures;
}

function comparableLegacy(out: Record<string, unknown>): Record<string, unknown> {
  const pick: Record<string, unknown> = {};
  for (const k of LEGACY_CLASSIFY_KEYS) {
    pick[k] = out[k];
  }
  return pick;
}

function comparableNew(out: Record<string, unknown>): Record<string, unknown> {
  const pick: Record<string, unknown> = {};
  for (const k of LEGACY_CLASSIFY_KEYS) {
    pick[k] = out[k];
  }
  return pick;
}

function createDateFromTime(timeStr: string, baseDate: Date): Date | null {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs: string[] = [];
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    if (typeof va === 'number' && typeof vb === 'number') {
      if (Math.abs(va - vb) > 0.001) diffs.push(`${k}: ${va} !== ${vb}`);
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      diffs.push(`${k}: ${JSON.stringify(va)} !== ${JSON.stringify(vb)}`);
    }
  }
  return diffs;
}

function main() {
  const fixtures = buildFixtures();
  let diffsTotal = 0;

  for (const fx of fixtures) {
    const input = {
      shift: fx.shift as Fixture['shift'] & { shiftDateObj: Date },
      now: fx.now,
      isValidEmployee: fx.isValidEmployee,
      isFranco: fx.isFranco,
      shiftCode: fx.shiftCode,
      effectiveEndDateObj: fx.effectiveEndDateObj,
      parentEmpleadoId: fx.parentEmpleadoId,
      createDateFromTime,
    };
    const legacy = comparableLegacy(legacyClassifyOpsShift(input));
    const modern = comparableNew(classifyOpsShift(input) as unknown as Record<string, unknown>);
    const diffs = diffKeys(legacy, modern);
    if (diffs.length) {
      diffsTotal += diffs.length;
      console.log(`DIFF\t${fx.id}\n  ${diffs.join('\n  ')}`);
    } else {
      console.log(`OK\t${fx.id}`);
    }
  }

  console.log('');
  console.log(`Fixtures: ${fixtures.length}`);
  console.log(`Diferencias: ${diffsTotal}`);
  if (diffsTotal > 0) process.exit(1);
  console.log('eval:ops-core OK — 0 diferencias');
}

main();

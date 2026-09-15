import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  Timestamp: { fromDate: (d: Date) => d },
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  getDoc: vi.fn(),
  writeBatch: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: null }) }));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/context/EmpresaContext', () => ({
  useEmpresa: () => ({ empresaId: 'test', empresa: { migracionCompleta: true } }),
}));
vi.mock('@/lib/multiempresa', () => ({
  shouldScopeQueriesToEmpresa: () => true,
  belongsToEmpresaView: () => true,
  updateDocForEmpresa: vi.fn(),
  stampEmpresaId: (d: unknown) => d,
  planificacionPublishLookupKey: () => '',
  parsePlanificacionEstadoDocId: () => null,
  empresaCollectionQuery: vi.fn(),
  filterSlaRowsByEmpresa: (_: unknown, rows: unknown[]) => rows,
  buildAuditLogsRecentQuery: vi.fn(),
  auditLogTimestampMs: () => 0,
  sortAuditLogRows: (rows: unknown[]) => rows,
}));
vi.mock('@/lib/refuerzo/turaContiguity', () => ({
  combinedContiguousRangeLabel: vi.fn(),
  isTuraContiguousToParent: vi.fn(),
  findParentShiftForTura: vi.fn(),
}));
vi.mock('@/lib/crm/slaObjectiveHours', () => ({ pickVigenteSlasForPeriod: (rows: unknown[]) => rows }));

import {
  isActionableOpsVacancy,
  isOpsShiftHoy,
  isPlaceholderOpsWindow,
  isVacancyDescubierto,
  OPS_PLAN_LOOKAHEAD_MS,
  sanitizeOpsShiftDates,
  shiftMatchesOpsViewTab,
  VACANCY_DESCUBIERTO_RATIO,
} from './useOperacionesMonitor';

const dt = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('isPlaceholderOpsWindow', () => {
  it('detecta ventana 00:00→00:00 como placeholder', () => {
    const start = dt(2026, 9, 13, 0, 0);
    const end = dt(2026, 9, 13, 0, 0);
    expect(isPlaceholderOpsWindow(start, end)).toBe(true);
  });

  it('no marca turnos M 07:00→15:00 como placeholder', () => {
    expect(isPlaceholderOpsWindow(dt(2026, 9, 13, 7), dt(2026, 9, 13, 15))).toBe(false);
  });
});

describe('sanitizeOpsShiftDates', () => {
  it('corrige placeholder M a banda CCT 07:00–15:00', () => {
    const raw = {
      code: 'M',
      shiftDateObj: dt(2026, 9, 13, 0, 0),
      endDateObj: dt(2026, 9, 13, 0, 0),
    };
    const fixed = sanitizeOpsShiftDates(raw);
    expect(fixed.opsBandSanitized).toBe(true);
    expect(fixed.shiftDateObj?.getHours()).toBe(7);
    expect(fixed.endDateObj?.getHours()).toBe(15);
  });
});

describe('isOpsShiftHoy', () => {
  const now = dt(2026, 9, 13, 10);

  it('incluye turno que empieza hoy', () => {
    expect(
      isOpsShiftHoy(
        { shiftDateObj: dt(2026, 9, 13, 15), endDateObj: dt(2026, 9, 13, 23), isCompleted: false },
        now,
      ),
    ).toBe(true);
  });

  it('incluye turno en curso overnight que empezó ayer', () => {
    const madrugada = dt(2026, 9, 13, 3);
    expect(
      isOpsShiftHoy(
        { shiftDateObj: dt(2026, 9, 12, 23), endDateObj: dt(2026, 9, 13, 7), isCompleted: false },
        madrugada,
      ),
    ).toBe(true);
  });

  it('incluye primer turno de mañana dentro del lookahead operativo', () => {
    const nightNow = dt(2026, 9, 13, 22);
    const tomorrowMorning = dt(2026, 9, 14, 7);
    expect(
      isOpsShiftHoy(
        { shiftDateObj: tomorrowMorning, endDateObj: dt(2026, 9, 14, 15), isCompleted: false },
        nightNow,
      ),
    ).toBe(true);
    expect(tomorrowMorning.getTime() - nightNow.getTime()).toBeLessThanOrEqual(OPS_PLAN_LOOKAHEAD_MS);
  });
});

describe('isActionableOpsVacancy', () => {
  const now = dt(2026, 9, 13, 10);

  it('vacante viva sin cobertura es accionable', () => {
    expect(
      isActionableOpsVacancy(
        {
          isUnassigned: true,
          shiftDateObj: dt(2026, 9, 13, 7),
          endDateObj: dt(2026, 9, 13, 15),
        },
        now,
      ),
    ).toBe(true);
  });

  it('no es accionable si fue devuelta a planificación', () => {
    expect(
      isActionableOpsVacancy(
        {
          isUnassigned: true,
          isReportedToPlanning: true,
          shiftDateObj: dt(2026, 9, 13, 7),
          endDateObj: dt(2026, 9, 13, 15),
        },
        now,
      ),
    ).toBe(false);
  });

  it('no es accionable si el slot ya terminó', () => {
    expect(
      isActionableOpsVacancy(
        {
          isUnassigned: true,
          shiftDateObj: dt(2026, 9, 13, 0),
          endDateObj: dt(2026, 9, 13, 6),
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('isVacancyDescubierto', () => {
  it('marca descubierto al superar el ratio configurado', () => {
    const now = dt(2026, 9, 13, 12);
    const shift = {
      isUnassigned: true,
      shiftDateObj: dt(2026, 9, 13, 7),
      endDateObj: dt(2026, 9, 13, 15),
    };
    expect(VACANCY_DESCUBIERTO_RATIO).toBe(0.55);
    expect(isVacancyDescubierto(shift, now)).toBe(true);
  });
});

describe('shiftMatchesOpsViewTab', () => {
  it('tab VACANTES solo muestra vacantes vivas', () => {
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);
    expect(
      shiftMatchesOpsViewTab({ isUnassigned: true, shiftDateObj: start, endDateObj: end }, 'VACANTES'),
    ).toBe(true);
    expect(
      shiftMatchesOpsViewTab({ isUnassigned: true, isReportedToPlanning: true }, 'VACANTES'),
    ).toBe(false);
  });
});

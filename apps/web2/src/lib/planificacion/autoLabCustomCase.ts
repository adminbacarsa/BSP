import type { V2PositionDef } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition, AutoLabRotationMode } from './autoLabCaseCatalog';
import { AUTO_LAB_CASES } from './autoLabCaseCatalog';
import {
    AUTO_LAB_DAY_LETTERS,
    monthBoundsYmd,
    suggestMinEmployeeCount,
    type AutoLabDayLetter,
} from './autoLabServicePeriod';

export const AUTO_LAB_CUSTOM_CASE_ID = 'case-custom';

export const AUTO_LAB_BAND_OPTIONS = ['M', 'T', 'N', 'D12', 'N12'] as const;
export type AutoLabBandCode = (typeof AUTO_LAB_BAND_OPTIONS)[number];

const BAND_DEFS: Record<string, { name: string; hours: number }> = {
    M: { name: 'Mañana', hours: 8 },
    T: { name: 'Tarde', hours: 8 },
    N: { name: 'Noche', hours: 8 },
    D12: { name: 'Diurno 12h', hours: 12 },
    N12: { name: 'Nocturno 12h', hours: 12 },
};

export const AUTO_LAB_ABSENCE_CODES = ['V', 'L', 'E', 'A', 'PG', 'AA'] as const;
export type AutoLabAbsenceCode = (typeof AUTO_LAB_ABSENCE_CODES)[number];

export interface AutoLabAbsenceDraft {
    empId: string;
    dateStr: string;
    code: AutoLabAbsenceCode;
}

export interface AutoLabCustomPositionDraft {
    id: string;
    positionName: string;
    /** Pax en paralelo para este puesto (quantity en Servicios). */
    qty: number;
    coverageType: '24hs' | 'custom';
    bands: AutoLabBandCode[];
    activeDayLetters: AutoLabDayLetter[];
    excludedDates: string[];
}

export interface AutoLabCustomDraft {
    title: string;
    serviceStartDate: string;
    serviceEndDate: string;
    excludedDates: string[];
    employeeCount: number;
    autoEmployeeCount: boolean;
    cycle: string;
    rotationMode: AutoLabRotationMode;
    slaVendidasOverride: number | null;
    positions: AutoLabCustomPositionDraft[];
    /** Ausencias / novedades para autocorrección del cronograma. */
    absences: AutoLabAbsenceDraft[];
}

function newPositionId(): string {
    return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultServicePeriodForNow(): { start: string; end: string } {
    const now = new Date();
    return monthBoundsYmd(now.getFullYear(), now.getMonth() + 1);
}

export function createDefaultCustomDraft(): AutoLabCustomDraft {
    const { start, end } = defaultServicePeriodForNow();
    return {
        title: 'Mi servicio sintético',
        serviceStartDate: start,
        serviceEndDate: end,
        excludedDates: [],
        employeeCount: 4,
        autoEmployeeCount: true,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidasOverride: null,
        absences: [],
        positions: [
            {
                id: newPositionId(),
                positionName: 'Puesto 1',
                qty: 1,
                coverageType: '24hs',
                bands: ['M', 'T', 'N'],
                activeDayLetters: [...AUTO_LAB_DAY_LETTERS],
                excludedDates: [],
            },
        ],
    };
}

export function customDraftFromCatalogCase(c: AutoLabCaseDefinition): AutoLabCustomDraft {
    const { start, end } = defaultServicePeriodForNow();
    return {
        title: c.title,
        serviceStartDate: c.serviceStartDate || start,
        serviceEndDate: c.serviceEndDate || end,
        excludedDates: [...(c.excludedDates || [])],
        employeeCount: c.employeeCount,
        autoEmployeeCount: false,
        cycle: c.cycle,
        rotationMode: c.rotationMode,
        slaVendidasOverride: c.slaVendidas ?? null,
        absences: [],
        positions: c.positions.map((pos, idx) => {
            const cov = String(pos.coverageType || '').toLowerCase();
            const is24 = cov === '24hs' || cov === '24' || cov === '24h';
            const bands = (pos.shifts || [])
                .map((s) => String(s.code || '').toUpperCase())
                .filter((code): code is AutoLabBandCode =>
                    (AUTO_LAB_BAND_OPTIONS as readonly string[]).includes(code),
                );
            const ad = pos.activeDays?.filter((d): d is AutoLabDayLetter =>
                (AUTO_LAB_DAY_LETTERS as readonly string[]).includes(d as AutoLabDayLetter),
            );
            return {
                id: newPositionId(),
                positionName: pos.positionName || `Puesto ${idx + 1}`,
                qty: Math.max(1, Number(pos.qty) || 1),
                coverageType: is24 ? '24hs' : 'custom',
                bands: bands.length > 0 ? bands : (is24 ? ['M', 'T', 'N'] : ['M']),
                activeDayLetters: ad && ad.length > 0 ? ad : [...AUTO_LAB_DAY_LETTERS],
                excludedDates: [...(pos.excludedDates || [])],
            };
        }),
    };
}

function bandsToShifts(bands: AutoLabBandCode[]): V2PositionDef['shifts'] {
    return bands.map((code) => ({
        code,
        name: BAND_DEFS[code]?.name || code,
        hours: BAND_DEFS[code]?.hours || 8,
    }));
}

export function buildCaseFromCustomDraft(draft: AutoLabCustomDraft): AutoLabCaseDefinition {
    const positions: V2PositionDef[] = draft.positions.map((p, idx) => {
        const bands = p.coverageType === '24hs' && p.bands.length === 0
            ? (['M', 'T', 'N'] as AutoLabBandCode[])
            : p.bands;
        const activeDays = p.activeDayLetters.length > 0
            ? [...p.activeDayLetters]
            : [...AUTO_LAB_DAY_LETTERS];
        return {
            positionName: p.positionName.trim() || `Puesto ${idx + 1}`,
            qty: Math.max(1, Number(p.qty) || 1),
            coverageType: p.coverageType,
            shifts: bandsToShifts(bands),
            activeDays,
            excludedDates: p.excludedDates.length > 0 ? [...p.excludedDates] : undefined,
        };
    });

    const rotateShiftsOverride =
        draft.rotationMode === 'rotative'
            ? true
            : draft.rotationMode === 'fixed'
              ? false
              : undefined;

    const employeeCount = draft.autoEmployeeCount
        ? suggestMinEmployeeCount(
            positions,
            draft.serviceStartDate,
            draft.serviceEndDate,
            draft.excludedDates,
        )
        : Math.max(1, Number(draft.employeeCount) || 1);

    return {
        id: AUTO_LAB_CUSTOM_CASE_ID,
        order: 99,
        title: draft.title.trim() || 'Servicio custom',
        subtitle: `${positions.length} puesto(s) · ${draft.serviceStartDate} → ${draft.serviceEndDate}`,
        description: 'Servicio sintético armado manualmente en Auto Lab. No está en Firestore.',
        expectations: [
            'Definí vigencia, puestos con pax y calendario de exclusiones.',
            'El cerebro usa solo los días activos del período en el mes simulado.',
        ],
        coverageNotes: 'Cobertura según pax × bandas × días activos de cada puesto, menos exclusiones.',
        positions,
        employeeCount,
        cycle: draft.cycle,
        rotationMode: draft.rotationMode,
        rotateShiftsOverride,
        slaVendidas: draft.slaVendidasOverride ?? undefined,
        serviceStartDate: draft.serviceStartDate,
        serviceEndDate: draft.serviceEndDate,
        excludedDates: draft.excludedDates.length > 0 ? [...draft.excludedDates] : undefined,
        absencesByDate: draft.absences.length > 0 ? [...draft.absences] : undefined,
    };
}

export function loadCustomDraftPreset(caseId: string): AutoLabCustomDraft | null {
    const preset = AUTO_LAB_CASES.find((c) => c.id === caseId);
    if (!preset) return null;
    return customDraftFromCatalogCase(preset);
}

export function suggestCustomEmployeeCount(draft: AutoLabCustomDraft): number {
    const built = buildCaseFromCustomDraft({ ...draft, autoEmployeeCount: false });
    return suggestMinEmployeeCount(
        built.positions,
        draft.serviceStartDate,
        draft.serviceEndDate,
        draft.excludedDates,
    );
}

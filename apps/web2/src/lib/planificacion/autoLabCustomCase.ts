import type { V2PositionDef } from './autoScheduleEngineV2';
import type { AutoLabCaseDefinition, AutoLabRotationMode } from './autoLabCaseCatalog';
import { AUTO_LAB_CASES } from './autoLabCaseCatalog';

export const AUTO_LAB_CUSTOM_CASE_ID = 'case-custom';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V'] as const;
const ALL_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export const AUTO_LAB_BAND_OPTIONS = ['M', 'T', 'N', 'D12', 'N12'] as const;
export type AutoLabBandCode = (typeof AUTO_LAB_BAND_OPTIONS)[number];

const BAND_DEFS: Record<string, { name: string; hours: number }> = {
    M: { name: 'Mañana', hours: 8 },
    T: { name: 'Tarde', hours: 8 },
    N: { name: 'Noche', hours: 8 },
    D12: { name: 'Diurno 12h', hours: 12 },
    N12: { name: 'Nocturno 12h', hours: 12 },
};

export interface AutoLabCustomPositionDraft {
    id: string;
    positionName: string;
    qty: number;
    coverageType: '24hs' | 'custom';
    bands: AutoLabBandCode[];
    weekdaysOnly: boolean;
}

export interface AutoLabCustomDraft {
    title: string;
    employeeCount: number;
    cycle: string;
    rotationMode: AutoLabRotationMode;
    slaVendidasOverride: number | null;
    positions: AutoLabCustomPositionDraft[];
}

function newPositionId(): string {
    return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultCustomDraft(): AutoLabCustomDraft {
    return {
        title: 'Mi servicio sintético',
        employeeCount: 4,
        cycle: '6+2',
        rotationMode: 'rotative',
        slaVendidasOverride: null,
        positions: [
            {
                id: newPositionId(),
                positionName: 'Puesto 1',
                qty: 1,
                coverageType: '24hs',
                bands: ['M', 'T', 'N'],
                weekdaysOnly: false,
            },
        ],
    };
}

export function customDraftFromCatalogCase(c: AutoLabCaseDefinition): AutoLabCustomDraft {
    return {
        title: c.title,
        employeeCount: c.employeeCount,
        cycle: c.cycle,
        rotationMode: c.rotationMode,
        slaVendidasOverride: c.slaVendidas ?? null,
        positions: c.positions.map((pos, idx) => {
            const cov = String(pos.coverageType || '').toLowerCase();
            const is24 = cov === '24hs' || cov === '24' || cov === '24h';
            const bands = (pos.shifts || [])
                .map((s) => String(s.code || '').toUpperCase())
                .filter((code): code is AutoLabBandCode =>
                    (AUTO_LAB_BAND_OPTIONS as readonly string[]).includes(code),
                );
            const ad = pos.activeDays;
            const weekdaysOnly = !!(ad && ad.length > 0 && ad.length < 7 && !ad.includes('S'));
            return {
                id: newPositionId(),
                positionName: pos.positionName || `Puesto ${idx + 1}`,
                qty: Math.max(1, Number(pos.qty) || 1),
                coverageType: is24 ? '24hs' : 'custom',
                bands: bands.length > 0 ? bands : (is24 ? ['M', 'T', 'N'] : ['M']),
                weekdaysOnly,
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
        return {
            positionName: p.positionName.trim() || `Puesto ${idx + 1}`,
            qty: Math.max(1, Number(p.qty) || 1),
            coverageType: p.coverageType,
            shifts: bandsToShifts(bands),
            activeDays: p.weekdaysOnly ? [...WEEKDAYS] : [...ALL_DAYS],
        };
    });

    const rotateShiftsOverride =
        draft.rotationMode === 'rotative'
            ? true
            : draft.rotationMode === 'fixed'
              ? false
              : undefined;

    return {
        id: AUTO_LAB_CUSTOM_CASE_ID,
        order: 99,
        title: draft.title.trim() || 'Servicio custom',
        subtitle: `${positions.length} puesto(s) · armado en lab`,
        description: 'Servicio sintético armado manualmente en Auto Lab. No está en Firestore.',
        expectations: [
            'Ajustá puestos, bandas y dotación hasta que la viabilidad cierre.',
            'Exportá JSON y pegalo en el chat para iterar con Crono.',
        ],
        coverageNotes: 'Cobertura según qty × bandas × días activos de cada puesto.',
        positions,
        employeeCount: Math.max(1, Number(draft.employeeCount) || 1),
        cycle: draft.cycle,
        rotationMode: draft.rotationMode,
        rotateShiftsOverride,
        slaVendidas: draft.slaVendidasOverride ?? undefined,
    };
}

export function loadCustomDraftPreset(caseId: string): AutoLabCustomDraft | null {
    const preset = AUTO_LAB_CASES.find((c) => c.id === caseId);
    if (!preset) return null;
    return customDraftFromCatalogCase(preset);
}

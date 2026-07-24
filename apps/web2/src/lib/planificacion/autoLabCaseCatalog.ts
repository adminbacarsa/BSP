import type { V2PositionDef } from './autoScheduleEngineV2';

export type AutoLabRotationMode = 'fixed' | 'rotative' | 'auto';

export interface AutoLabCaseAbsence {
    empIndex: number;
    dayOfMonth: number;
    code: string;
}

/** Ausencia por guardia y fecha (YYYY-MM-DD) — lab custom y autocorrección. */
export interface AutoLabCaseAbsenceByDate {
    empId: string;
    dateStr: string;
    code: string;
}

export interface AutoLabCaseDefinition {
    id: string;
    order: number;
    title: string;
    subtitle: string;
    description: string;
    expectations: string[];
    coverageNotes: string;
    positions: V2PositionDef[];
    employeeCount: number;
    cycle: string;
    rotationMode: AutoLabRotationMode;
    rotateShiftsOverride?: boolean;
    cycleOverride?: string;
    absences?: AutoLabCaseAbsence[];
    /** Ausencias por guardia y fecha (prioridad sobre absences por índice). */
    absencesByDate?: AutoLabCaseAbsenceByDate[];
    contingencyDays?: number[];
    slaVendidas?: number;
    /** Vigencia del contrato (modo custom / servicio real). */
    serviceStartDate?: string;
    serviceEndDate?: string;
    /** Días sin servicio a nivel contrato (YYYY-MM-DD). */
    excludedDates?: string[];
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V'] as const;
const ALL_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

const M_T_N: V2PositionDef['shifts'] = [
    { code: 'M', name: 'Mañana', hours: 8 },
    { code: 'T', name: 'Tarde', hours: 8 },
    { code: 'N', name: 'Noche', hours: 8 },
];

function puesto24hs(name: string, qty = 1): V2PositionDef {
    return {
        positionName: name,
        qty,
        coverageType: '24hs',
        shifts: M_T_N,
        activeDays: [...ALL_DAYS],
    };
}

export const AUTO_LAB_CASES: AutoLabCaseDefinition[] = [
    {
        id: 'case-01-oficina-m',
        order: 1,
        title: 'Oficina — 1 guardia, solo M',
        subtitle: '1 puesto · 1 banda · L–V',
        description:
            'El caso más simple: un solo vigilador cubre mañana de lunes a viernes. Sin rotación M/T/N ni cobertura 24hs.',
        expectations: [
            'Viabilidad OK con 1 guardia si el SLA coincide con ~22 días × 8h.',
            'Ciclo 6+2 con banda fija (sin péndulo M→T→N).',
            'No aplica objetivo 4/4 ni plantilla rotativa.',
        ],
        coverageNotes: 'Servicio diario = 1 slot (M). La cobertura mide 1/1 en días activos del puesto.',
        positions: [
            {
                positionName: 'Recepción',
                qty: 1,
                coverageType: 'custom',
                shifts: [{ code: 'M', name: 'Mañana', hours: 8 }],
                activeDays: [...WEEKDAYS],
            },
        ],
        employeeCount: 1,
        cycle: '6+2',
        rotationMode: 'fixed',
        rotateShiftsOverride: false,
    },
    {
        id: 'case-02-deposito-mt',
        order: 2,
        title: 'Depósito — 2 puestos M y T',
        subtitle: '2 puestos · bandas fijas · L–V',
        description:
            'Dos puestos independientes: uno solo mañana y otro solo tarde. Cada guardia queda anclado a su banda.',
        expectations: [
            'Viabilidad OK con 2 guardias (1 por puesto).',
            'Servicio diario = 2 slots (M + T), sin noche.',
            'Rotación OFF: cada puesto tiene banda fija.',
        ],
        coverageNotes: '2/2 en cobertura diaria (L–V): un guardia en M y otro en T. Pico en servicio = 2.',
        positions: [
            {
                positionName: 'Puesto Mañana',
                qty: 1,
                coverageType: 'custom',
                shifts: [{ code: 'M', name: 'Mañana', hours: 8 }],
                activeDays: [...WEEKDAYS],
            },
            {
                positionName: 'Puesto Tarde',
                qty: 1,
                coverageType: 'custom',
                shifts: [{ code: 'T', name: 'Tarde', hours: 8 }],
                activeDays: [...WEEKDAYS],
            },
        ],
        employeeCount: 2,
        cycle: '6+2',
        rotationMode: 'fixed',
        rotateShiftsOverride: false,
    },
    {
        id: 'case-03-24hs-mtn',
        order: 3,
        title: 'Objetivo 24hs — M+T+N rotativo',
        subtitle: '1 puesto · 24hs · 6+2 · rotación',
        description:
            'Baseline Bacar: un puesto 24hs con tres bandas. El cerebro calcula plantilla ~4 guardias y activa rotación M→T→N.',
        expectations: [
            'Plantilla total ≈ 4 (3 en servicio + 1 en franco rotativo).',
            'Servicio diario Modo 8 = 3 slots (M+T+N).',
            'Rotación ON si la dotación cierra viabilidad.',
            'Ciclo elegido: 6+2.',
        ],
        coverageNotes: 'Objetivo 3/3 por día en Modo 8. Con 4 guardias y rotación, el pool de francos rota.',
        positions: [puesto24hs('Puesto 1', 1)],
        employeeCount: 4,
        cycle: '6+2',
        rotationMode: 'rotative',
        rotateShiftsOverride: true,
    },
    {
        id: 'case-04-hospital-4pax',
        order: 4,
        title: 'Hospital — 4 puestos 24hs',
        subtitle: '4 puestos · 24hs · objetivo 4/4',
        description:
            'Escenario tipo Misericordia: cuatro puestos 24hs simultáneos. Exige ~16 guardias y cierre M+T+N en cada puesto.',
        expectations: [
            'Plantilla total ≈ 16 (12 en servicio + 4 en franco).',
            'Servicio diario = 12 slots (4 puestos × M+T+N).',
            'Viabilidad exige dotación acorde al factor 6+2.',
            'Rotación ON; referencia para validar motor V4 en producción.',
        ],
        coverageNotes: '4/4 puestos con M+T+N cerrado cada día. Pico en servicio = 4 guardias simultáneos.',
        positions: [
            puesto24hs('Puesto 1', 1),
            puesto24hs('Puesto 2', 1),
            puesto24hs('Puesto 3', 1),
            puesto24hs('Puesto 4', 1),
        ],
        employeeCount: 16,
        cycle: '6+2',
        rotationMode: 'rotative',
        rotateShiftsOverride: true,
        slaVendidas: 2880,
    },
    {
        id: 'case-05-pax2-ausencia',
        order: 5,
        title: '24hs pax 2 — ausencia y cobertura',
        subtitle: '1 puesto · pax 2 · 8 guardias · ausencia día 17',
        description:
            'Escenario real Bacar: un puesto 24hs con dos personas simultáneas (pax 2). G01 con enfermedad el día 17. Valida RET externo, contingencia híbrida sin RET y que no se mezcle D12+D12+N12+M+T.',
        expectations: [
            'Servicio diario = 6 slots (2× M+T+N).',
            'Con RET externo: dos rotaciones M+T+N × 8h (ej. G02 M, G03 T, G05 N + G06 M, G07 T, RET1 N).',
            'Sin RET: contingencia híbrida — 1× D12+N12 + 1× M+T+N (5 guardias).',
            'RET en celda = capacidad disponible, no hueco SLA.',
            'No mezclar esquemas incompatibles (D12+M+T = 28h).',
        ],
        coverageNotes:
            'Prioridad: Modo 8 → RET interno → RET externo → híbrido D12+N12+M+T+N → FT manual.',
        positions: [puesto24hs('Puesto 1', 2)],
        employeeCount: 8,
        cycle: '6+2',
        rotationMode: 'rotative',
        rotateShiftsOverride: true,
        absences: [{ empIndex: 0, dayOfMonth: 17, code: 'E' }],
    },
];

/** Próximo ítem (fuera del lab por ahora): servicios reales desde Firestore/SLA. */
export const AUTO_LAB_PLANNED_CASES: Pick<AutoLabCaseDefinition, 'id' | 'title' | 'subtitle' | 'description'>[] = [
    {
        id: 'case-06-servicio-real',
        title: 'Servicio real — SLA + turnos publicados',
        subtitle: 'Cargar desde emulador/producción',
        description:
            'Conectar un objetivo real (servicios_sla + turnos del mes anterior) para validar el motor contra datos Bacar. Sabiduría de coberturas y ranking histórico — pendiente de integrar.',
    },
];

export function getAutoLabCaseById(id: string): AutoLabCaseDefinition | undefined {
    return AUTO_LAB_CASES.find((c) => c.id === id);
}

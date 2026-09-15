export type PlanningTraceTone = 'slate' | 'rose' | 'amber' | 'emerald' | 'indigo' | 'orange';

export type PlanningTraceStep = {
    key: string;
    title: string;
    detail: string;
    tone: PlanningTraceTone;
};

export const PLANNING_TRACE_TONE: Record<PlanningTraceTone, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    orange: 'border-orange-200 bg-orange-50 text-orange-900',
};

export type BuildPlanningCellTraceOpts = {
    role: 'titular' | 'coverer' | 'normal';
    titularName: string;
    dateStr: string;
    plannedCode?: string | null;
    plannedSchedule?: string | null;
    plannedPosition?: string | null;
    plannedService?: string | null;
    absenceType?: string | null;
    absenceReason?: string | null;
    isOpsAbsent?: boolean;
    isPresent?: boolean;
    operacionallyCovered?: boolean;
    coveredByName?: string | null;
    coveredByCode?: string | null;
    coveredByHow?: string | null;
    vacancyOpen?: boolean;
    covererName?: string | null;
    coversAbsenceName?: string | null;
    covererCode?: string | null;
    covererOrigin?: string | null;
};

/** Cadena legible: planificado → evento → vacante → cobertura (o inverso si es el cubridor). */
export function buildPlanningCellTrace(opts: BuildPlanningCellTraceOpts): PlanningTraceStep[] {
    const steps: PlanningTraceStep[] = [];
    const planBits = [
        opts.plannedCode || null,
        opts.plannedSchedule || null,
        opts.plannedPosition && opts.plannedPosition !== 'General' ? opts.plannedPosition : null,
        opts.plannedService || null,
    ].filter(Boolean);

    if (opts.role === 'coverer') {
        steps.push({
            key: 'coverer-shift',
            title: '1 · Turno del cubridor',
            detail: [
                opts.covererName || 'Guardia',
                opts.covererCode || opts.plannedCode || '',
                opts.plannedSchedule || '',
            ].filter(Boolean).join(' · ') || 'Turno de cobertura operativa',
            tone: 'indigo',
        });
        steps.push({
            key: 'coverer-target',
            title: '2 · Cubrió a',
            detail: opts.coversAbsenceName
                ? `${opts.coversAbsenceName}${opts.covererOrigin ? ` · vía ${String(opts.covererOrigin).replace(/_/g, ' ')}` : ''}`
                : 'Titular no vinculado en el doc (falta coversAbsenceEmployeeName)',
            tone: opts.coversAbsenceName ? 'emerald' : 'amber',
        });
        steps.push({
            key: 'coverer-effect',
            title: '3 · Efecto',
            detail: 'En liquidación/reportes: el titular figura como novedad/ausencia; las horas del puesto las computa este turno de cobertura (no el VACANTE).',
            tone: 'slate',
        });
        return steps;
    }

    steps.push({
        key: 'plan',
        title: '1 · Planificado',
        detail: [
            opts.titularName,
            planBits.length ? planBits.join(' · ') : 'Sin detalle de banda',
        ].filter(Boolean).join(' — '),
        tone: 'slate',
    });

    if (opts.absenceType || opts.isOpsAbsent) {
        const eventDetail = opts.absenceType
            ? `${opts.absenceType}${opts.absenceReason ? ` — ${opts.absenceReason}` : ''}`
            : 'Ausencia operativa (Ops: no se presentó / isAbsent). La celda conserva el código planificado; el punto rojo lo marca.';
        steps.push({
            key: 'event',
            title: '2 · Qué ocurrió',
            detail: eventDetail,
            tone: 'rose',
        });
    } else if (opts.isPresent) {
        steps.push({
            key: 'event',
            title: '2 · Qué ocurrió',
            detail: 'Presente / fichada registrada',
            tone: 'emerald',
        });
    } else {
        steps.push({
            key: 'event',
            title: '2 · Qué ocurrió',
            detail: 'Sin novedad RRHH ni ausencia operativa registrada en este doc',
            tone: 'slate',
        });
    }

    if (opts.vacancyOpen && !opts.coveredByName) {
        steps.push({
            key: 'vacancy',
            title: '3 · Hueco',
            detail: 'Quedó VACANTE (doc operativo o sin asignación nominal). El puesto no tiene cubridor nominal todavía.',
            tone: 'amber',
        });
    } else if (opts.vacancyOpen && opts.coveredByName) {
        steps.push({
            key: 'vacancy',
            title: '3 · Hueco → resuelto',
            detail: `Había vacante por ausencia; Ops/plan asignó cobertura a ${opts.coveredByName}.`,
            tone: 'orange',
        });
    } else {
        steps.push({
            key: 'vacancy',
            title: '3 · Hueco',
            detail: opts.coveredByName
                ? 'No queda vacante abierta (hay cubridor nominal).'
                : (opts.absenceType || opts.isOpsAbsent)
                    ? 'Sin vacante abierta detectada — puede estar descubierto o cubierto solo por capacidad del puesto.'
                    : 'Sin hueco operativo',
            tone: opts.coveredByName ? 'emerald' : 'amber',
        });
    }

    if (opts.coveredByName) {
        steps.push({
            key: 'cover',
            title: '4 · Cubierto por',
            detail: [
                opts.coveredByName,
                opts.coveredByCode ? `turno ${opts.coveredByCode}` : null,
                opts.coveredByHow || null,
                opts.operacionallyCovered ? '✓ cubierto en Ops' : null,
            ].filter(Boolean).join(' · '),
            tone: 'emerald',
        });
    } else if (opts.absenceType || opts.isOpsAbsent) {
        steps.push({
            key: 'cover',
            title: '4 · Cubierto por',
            detail: 'Sin cobertura nominal registrada. En grilla: punto rojo = ausente; no implica “esperar 24 h” para ver al cubridor.',
            tone: 'amber',
        });
    }

    return steps;
}

export function formatPlanningTraceTooltip(steps: PlanningTraceStep[]): string {
    return steps.map(s => `${s.title}: ${s.detail}`).join('\n');
}

import React, { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AlertTriangle, ChevronRight, Clock, MapPin, Search, Split } from 'lucide-react';
import { toast } from 'sonner';
import { employeeKmToObjective, formatKmLabel } from '@/lib/planificacion/planificacionDotacionUtils';
import { calcShiftHours } from '@/lib/planificacion/planificacionBandHours';
import { shiftCountsForEmployeeCronoHours } from '@/lib/planificacion/deploymentRoles';
import { experienciaBadgeForReplacement } from '@/lib/planificacion/experienciaObjetivos';
import {
    listDateRangeInclusive,
    collectVacancyFrancoConflicts,
    VACANCY_NON_WORK_CODES,
    resolveVacancyDayCoverage,
    formatVacancyDayCoverageLabel,
    vacancyDayHasCoverage,
    resolveTitularVacancyWorkShift,
    describeVacancySplitPlan,
    resolveVacancySplitSegmentTimes,
    vacancySplitUsesManualExtraHours,
    type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import {
    listVacancyGapBandOptions,
    inferTitularGapBandFromHistory,
    resolveEffectiveVacancyGapTitular,
    buildTitularVacancyFromGapOption,
} from '@/lib/planificacion/vacancyGapBands';
import { slaBlocksForPositionShift } from '@/lib/planificacion/splitShiftDisplay';
import {
    listExtensionCandidates,
    listEarlyStartCandidates,
    neighborBandsForTargetAtPosition,
    collectSplitFrancoConflicts,
    formatFrancoConflictSummary,
    type FrancoCoverageConflict,
} from '@/lib/planificacion/planningRecompositionApply';

export type PlanningVacancyModalProps = {
    vacancyData: any;
    vacancyActiveDates: Set<string>;
    setVacancyActiveDates: Dispatch<SetStateAction<Set<string>>>;
    employees: any[];
    currentDate: Date;
    pendingChanges: Record<string, any>;
    shiftsMap: Record<string, any>;
    effectivePosStructure: any[];
    selectedReplacement: string;
    setSelectedReplacement: Dispatch<SetStateAction<string>>;
    vacancyDayCoverages: Record<string, VacancyDayCoverage>;
    setVacancyDayCoverages: Dispatch<SetStateAction<Record<string, VacancyDayCoverage>>>;
    vacancyEditingDay: string | null;
    setVacancyEditingDay: Dispatch<SetStateAction<string | null>>;
    setVacancyApplyToAllSelected: Dispatch<SetStateAction<boolean>>;
    vacancyReplacementOpen: boolean;
    setVacancyReplacementOpen: Dispatch<SetStateAction<boolean>>;
    vacancyPickerTab: 'substitute' | 'split';
    setVacancyPickerTab: Dispatch<SetStateAction<'substitute' | 'split'>>;
    vacancySplitExtId: string;
    setVacancySplitExtId: Dispatch<SetStateAction<string>>;
    vacancySplitAdelId: string;
    setVacancySplitAdelId: Dispatch<SetStateAction<string>>;
    vacancySplitExtExtraHours: number | null;
    setVacancySplitExtExtraHours: Dispatch<SetStateAction<number | null>>;
    vacancySplitSecondExtraHours: number | null;
    setVacancySplitSecondExtraHours: Dispatch<SetStateAction<number | null>>;
    activePosition: string | null;
    vacancyGapBandOverride: string | null;
    setVacancyGapBandOverride: Dispatch<SetStateAction<string | null>>;
    vacancyApplyToAllSelected: boolean;
    selectedObjectiveData: any;
    selectedObjective: string;
    vacancyReplacementSearch: string;
    setVacancyReplacementSearch: Dispatch<SetStateAction<string>>;
    vacancyFrancoAuthApproved: boolean;
    setVacancyFrancoAuthApproved: Dispatch<SetStateAction<boolean>>;
    requestSupervisorFrancoAuth: (conflicts: FrancoCoverageConflict[], onAuthorized: () => void | Promise<void>, contextLabel?: string) => void;
    vacancyReplacementPanelRef: RefObject<HTMLDivElement>;
    finalizeVacancyModal: () => void;
    handleProcessVacancy: () => void;
};

export default function PlanningVacancyModal({
    vacancyData,
    vacancyActiveDates,
    setVacancyActiveDates,
    employees,
    currentDate,
    pendingChanges,
    shiftsMap,
    effectivePosStructure,
    selectedReplacement,
    setSelectedReplacement,
    vacancyDayCoverages,
    setVacancyDayCoverages,
    vacancyEditingDay,
    setVacancyEditingDay,
    setVacancyApplyToAllSelected,
    vacancyReplacementOpen,
    setVacancyReplacementOpen,
    vacancyPickerTab,
    setVacancyPickerTab,
    vacancySplitExtId,
    setVacancySplitExtId,
    vacancySplitAdelId,
    setVacancySplitAdelId,
    vacancySplitExtExtraHours,
    setVacancySplitExtExtraHours,
    vacancySplitSecondExtraHours,
    setVacancySplitSecondExtraHours,
    activePosition,
    vacancyGapBandOverride,
    setVacancyGapBandOverride,
    vacancyApplyToAllSelected,
    selectedObjectiveData,
    selectedObjective,
    vacancyReplacementSearch,
    setVacancyReplacementSearch,
    vacancyFrancoAuthApproved,
    setVacancyFrancoAuthApproved,
    requestSupervisorFrancoAuth,
    vacancyReplacementPanelRef,
    finalizeVacancyModal,
    handleProcessVacancy,
}: PlanningVacancyModalProps) {
                    const absType = vacancyData?.type || '';
                    const absenceDateRange = vacancyData?.startDate
                        ? listDateRangeInclusive(vacancyData.startDate, vacancyData.endDate || vacancyData.startDate)
                        : [];
                    const isVac = absType === 'Vacaciones';
                    const isEnf = absType === 'Enfermedad' || absType === 'ART';
                    const isPG = absType === 'PG Permiso Gremial';
                    const isLic = absType === 'Licencia Esp.' || isPG;
                    const isInj = absType === 'Injustificada';
                    const color = isVac ? 'teal' : isEnf ? 'rose' : isPG ? 'blue' : isLic ? 'purple' : 'amber';
                    const colorMap: any = { teal: 'border-l-teal-500 bg-teal-50 text-teal-700', rose: 'border-l-rose-500 bg-rose-50 text-rose-700', purple: 'border-l-purple-500 bg-purple-50 text-purple-700', blue: 'border-l-blue-500 bg-blue-50 text-blue-700', amber: 'border-l-amber-500 bg-amber-50 text-amber-700' };
                    const btnColor: any = { teal: 'bg-teal-600 hover:bg-teal-700 shadow-teal-200', rose: 'bg-rose-600 hover:bg-rose-700 shadow-rose-200', purple: 'bg-purple-600 hover:bg-purple-700 shadow-purple-200', blue: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200', amber: 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' };
                    const title = isVac ? 'Vacaciones — Planificar Cobertura' : isEnf ? 'Ausencia Médica — Cobertura Temporal' : isPG ? 'PG Permiso Gremial — Planificar Cobertura' : isLic ? 'Licencia Especial — Planificar Cobertura' : 'Ausencia Injustificada — Gestionar';
                    const hint = isVac
                        ? 'Elegí qué días procesar y quién cubre cada uno. Por día: traer suplente (RET/ESC/libre) o ext+adel con guardias del cronograma.'
                        : isEnf
                            ? 'Por día: suplente externo o ext+adel con personal ya en servicio ese día.'
                            : isPG
                                ? 'Asigná cobertura por día: suplente o ext+adel desde el cronograma.'
                                : isLic
                                    ? 'Suplente o ext+adel por día; ordenados por cercanía (suplentes).'
                                    : 'Podés asignar cobertura por día o dejar vacante.';
                    const sortedActiveDates = [...vacancyActiveDates].sort();
                    const candidateDate = vacancyEditingDay || sortedActiveDates[0] || vacancyData?.startDate;
                    const splitReferenceDate = vacancyEditingDay || candidateDate || '';
                    const isBulkCoverageMode = vacancyReplacementOpen && !vacancyEditingDay;
                    const vacancyEmployeesById: Record<string, any> = {};
                    employees.forEach((e: any) => { if (e.id) vacancyEmployeesById[e.id] = e; });
                    const formatShortDay = (ymd: string) => {
                        const [, m, d] = ymd.split('-');
                        return `${d}/${m}`;
                    };
                    const formatTitularChip = (tit: NonNullable<ReturnType<typeof resolveTitularShiftForDay>>) => {
                        const band = tit.bandLabel !== tit.code ? tit.bandLabel : null;
                        const sched = tit.scheduleLabel && tit.scheduleLabel !== '—' ? tit.scheduleLabel : null;
                        return { code: tit.code, band, sched, position: tit.positionName };
                    };
                    const renderTitularChipLine = (tit: NonNullable<ReturnType<typeof resolveTitularShiftForDay>>) => {
                        const c = formatTitularChip(tit);
                        return (
                            <>
                                <span className="font-mono">{c.code}</span>
                                {c.band && <><span className="text-slate-300 mx-0.5">·</span><span>{c.band}</span></>}
                                <span className="text-slate-300 mx-0.5">·</span>
                                <span>{c.position}</span>
                                {c.sched && <><span className="text-slate-300 mx-0.5">·</span><span className="font-mono">{c.sched}</span></>}
                            </>
                        );
                    };
                    const toggleVacancyDate = (d: string) => {
                        setVacancyActiveDates((prev) => {
                            const next = new Set(prev);
                            if (next.has(d)) next.delete(d); else next.add(d);
                            return next;
                        });
                    };
                    const resolveDayCoverageForUi = (dateStr: string) =>
                        resolveVacancyDayCoverage(dateStr, vacancyDayCoverages, selectedReplacement);
                    const resolveDayCoverageLabel = (dateStr: string) =>
                        formatVacancyDayCoverageLabel(resolveDayCoverageForUi(dateStr), vacancyEmployeesById);
                    const willAssignAny = [...vacancyActiveDates].some((d) => vacancyDayHasCoverage(resolveDayCoverageForUi(d)));
                    const vacancyEmptyActiveDays = sortedActiveDates.filter((d) => !vacancyDayHasCoverage(resolveDayCoverageForUi(d))).length;
                    const vacancyConfiguredDays = sortedActiveDates.length - vacancyEmptyActiveDays;
                    const getTypicalShiftForTitular = (empId: string) => {
                        const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
                        const daysInMo = new Date(yr, mo + 1, 0).getDate();
                        const freq: Record<string, { count: number; shift: any }> = {};
                        for (let d = 1; d <= daysInMo; d++) {
                            const k = `${empId}_${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            const pending = pendingChanges[k];
                            const s = (pending && !pending.isDeleted) ? pending : shiftsMap[k];
                            if (s?.code && !VACANCY_NON_WORK_CODES.has(String(s.code).toUpperCase())) {
                                if (!freq[s.code]) freq[s.code] = { count: 0, shift: s };
                                freq[s.code].count++;
                            }
                        }
                        return Object.values(freq).sort((a, b) => b.count - a.count)[0]?.shift || null;
                    };
                    const resolveTitularShiftForDay = (dateStr: string) => resolveTitularVacancyWorkShift(
                        vacancyData?.employeeId || '',
                        dateStr,
                        shiftsMap,
                        pendingChanges,
                        getTypicalShiftForTitular,
                        (positionName, code) => slaBlocksForPositionShift(effectivePosStructure, positionName, code),
                        { absenceBlockStart: vacancyData?.startDate },
                    );
                    const openDayCoveragePicker = (d: string) => {
                        const existing = vacancyDayCoverages[d] ?? resolveVacancyDayCoverage(d, {}, selectedReplacement);
                        const configuredCount = sortedActiveDates.filter((date) =>
                            vacancyDayHasCoverage(vacancyDayCoverages[date] ?? { mode: 'none' }),
                        ).length;
                        if (sortedActiveDates.length > 1 && configuredCount === 0) {
                            setVacancyEditingDay(null);
                            setVacancyApplyToAllSelected(true);
                        } else {
                            setVacancyEditingDay(d);
                            setVacancyApplyToAllSelected(sortedActiveDates.length > 1);
                        }
                        setVacancyReplacementOpen(true);
                        if (existing.mode === 'split') {
                            setVacancyPickerTab('split');
                            setVacancySplitExtId(existing.extEmpId);
                            setVacancySplitAdelId(existing.adelEmpId);
                            setVacancySplitExtExtraHours(existing.extExtraHours ?? null);
                            setVacancySplitSecondExtraHours(existing.secondExtExtraHours ?? null);
                        } else {
                            setVacancyPickerTab('substitute');
                            setVacancySplitExtId('');
                            setVacancySplitAdelId('');
                            setVacancySplitExtExtraHours(null);
                            setVacancySplitSecondExtraHours(null);
                        }
                    };
                    const vacancyPosSla = effectivePosStructure as import('@/lib/planificacion/vacancySplitBands').VacancyPositionSla[];
                    const vacancyGapPreferredPosition =
                        activePosition
                        || (splitReferenceDate ? resolveTitularShiftForDay(splitReferenceDate)?.positionName : null)
                        || effectivePosStructure[0]?.positionName
                        || null;
                    // null → mostrar todas las bandas del SLA (no solo el puesto del titular);
                    // vacancyGapPreferredPosition solo se usa para inferir la selección por defecto.
                    const vacancyGapBandOptions = listVacancyGapBandOptions(vacancyPosSla, null);
                    const resolveEffectiveTitularForDay = (dateStr: string) => {
                        const raw = resolveTitularShiftForDay(dateStr);
                        const prefPos = activePosition || raw?.positionName || vacancyGapPreferredPosition;
                        const options = listVacancyGapBandOptions(vacancyPosSla, prefPos);
                        // Solo usar historial si NO hay turno del día (ni originalCode en la celda V/E).
                        // Si tenía T ese día, el default debe ser T — no el patrón más frecuente del mes.
                        const hist = !raw
                            ? inferTitularGapBandFromHistory(
                                vacancyData?.employeeId || '',
                                vacancyData?.startDate,
                                vacancyPosSla,
                                prefPos,
                                shiftsMap,
                                pendingChanges,
                            )
                            : null;
                        const inferred = hist
                            ? buildTitularVacancyFromGapOption(
                                hist,
                                'history_inferred',
                                'Patrón previo al bloque (cronograma)',
                                undefined,
                            )
                            : null;
                        return resolveEffectiveVacancyGapTitular(
                            raw || inferred,
                            vacancyGapBandOverride,
                            vacancyGapBandOptions,
                            vacancyPosSla,
                        );
                    };
                    const resolveTitularForCoverageDay = (dateStr: string, refDate?: string) =>
                        resolveEffectiveTitularForDay(dateStr)
                        || (refDate ? resolveEffectiveTitularForDay(refDate) : null)
                        || (sortedActiveDates[0] ? resolveEffectiveTitularForDay(sortedActiveDates[0]) : null);
                    const shouldApplyCoverageToAllDays = () =>
                        isBulkCoverageMode
                        || (vacancyApplyToAllSelected && sortedActiveDates.length > 1);
                    const splitApplyButtonLabel = shouldApplyCoverageToAllDays()
                        ? `Aplicar ext + adel a ${sortedActiveDates.length} días`
                        : 'Aplicar ext + adel este día';
                    const replicateCoverageToEmptyDays = () => {
                        const templateDay = sortedActiveDates.find((d) =>
                            vacancyDayHasCoverage(vacancyDayCoverages[d] ?? { mode: 'none' }),
                        );
                        if (!templateDay) return;
                        const template = vacancyDayCoverages[templateDay]
                            ?? resolveVacancyDayCoverage(templateDay, {}, selectedReplacement);
                        if (!vacancyDayHasCoverage(template)) return;
                        const patch: Record<string, VacancyDayCoverage> = {};
                        for (const d of sortedActiveDates) {
                            if (vacancyDayHasCoverage(vacancyDayCoverages[d] ?? { mode: 'none' })) continue;
                            if (template.mode === 'substitute') {
                                patch[d] = { mode: 'substitute', employeeId: template.employeeId };
                            } else if (template.mode === 'split') {
                                const tit = resolveTitularForCoverageDay(d, templateDay);
                                if (!tit) continue;
                                patch[d] = {
                                    mode: 'split',
                                    extEmpId: template.extEmpId,
                                    adelEmpId: template.adelEmpId,
                                    gapBand: tit.code,
                                    gapPosition: tit.positionName,
                                    extExtraHours: template.extExtraHours,
                                    secondExtExtraHours: template.secondExtExtraHours,
                                };
                            }
                        }
                        const filled = Object.keys(patch).length;
                        if (filled === 0) {
                            toast.error('No quedan días vacíos para completar o falta inferir el turno del titular.');
                            return;
                        }
                        setVacancyDayCoverages((prev) => ({ ...prev, ...patch }));
                        toast.success(`Cobertura replicada en ${filled} día(s) restante(s).`);
                    };
                    // Calcular horas mensuales del mes en curso
                    const getEmpMonthHours = (empId: string): number => {
                        const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
                        const days = new Date(yr, mo + 1, 0).getDate(); let h = 0;
                        for (let d = 1; d <= days; d++) {
                            const key = `${empId}_${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                            const p = pendingChanges[key];
                            const s = shiftsMap[key];
                            const sh = p && !p.isDeleted ? p : s;
                            if (!sh?.code) continue;
                            if (!shiftCountsForEmployeeCronoHours(sh)) continue;
                            h += calcShiftHours(sh);
                        }
                        return h;
                    };
                    // Clasificar disponibilidad en la fecha de la ausencia
                    const NON_AVAILABLE = new Set(['F','FF','FP','FT','V','L','PG','A','E','AA','PAST','LOCKED']);
                    type VacancyDayRole = 'RETEN' | 'ESC' | 'FREE' | 'WORKING';
                    const getEmpDayRole = (empId: string, dateStr: string): VacancyDayRole => {
                        const key = `${empId}_${dateStr}`;
                        const s = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
                        if (!s || s.isDeleted) return 'FREE';
                        const code = String(s.code || '').toUpperCase();
                        if (code === 'RET') return 'RETEN';
                        if (code === 'ESC') return 'ESC';
                        if (NON_AVAILABLE.has(code)) return 'FREE';
                        return 'WORKING';
                    };
                    const objLat = Number(selectedObjectiveData?.lat ?? 0);
                    const objLng = Number(selectedObjectiveData?.lng ?? 0);
                    const sortKm = (a: { km: number }, b: { km: number }) => a.km - b.km;
                    const candidatos = employees
                        .filter(e => e.id !== vacancyData?.employeeId)
                        .map(e => ({
                            ...e,
                            monthHours: getEmpMonthHours(e.id),
                            dayRole: getEmpDayRole(e.id, candidateDate || vacancyData?.startDate || ''),
                            km: employeeKmToObjective(e, objLat, objLng) ?? 9999,
                            expBadge: experienciaBadgeForReplacement(e.id, selectedObjective || '', e.experienciaObjetivos, e.preferredObjectiveId),
                        }))
                        .filter(e => e.dayRole === 'RETEN' || e.dayRole === 'ESC' || e.dayRole === 'FREE');
                    const q = vacancyReplacementSearch.toLowerCase().trim();
                    const matchesSearch = (e: typeof candidatos[0]) => {
                        if (!q) return true;
                        return `${e.name || ''} ${e.lastName || ''} ${e.firstName || ''} ${e.legajo || ''}`.toLowerCase().includes(q);
                    };
                    const retenCandidatos = candidatos.filter(e => e.dayRole === 'RETEN' && matchesSearch(e)).sort(sortKm);
                    const escCandidatos = candidatos.filter(e => e.dayRole === 'ESC' && matchesSearch(e)).sort(sortKm);
                    const sinTurnoCandidatos = candidatos.filter(e => e.dayRole === 'FREE' && matchesSearch(e)).sort(sortKm);
                    const vacancySplitListCtx = {
                        positionStructure: effectivePosStructure as import('@/lib/planificacion/vacancySplitBands').VacancyPositionSla[],
                        // Ext+Adel: banda vecina de cualquier puesto del objetivo (cubre con coversPositionName).
                        preferSamePosition: false,
                    };
                    const splitTitularShift = (() => {
                        if (splitReferenceDate) {
                            return resolveEffectiveTitularForDay(splitReferenceDate);
                        }
                        if (vacancyGapBandOverride) {
                            const parts = vacancyGapBandOverride.split('__');
                            const code = parts[0].toUpperCase();
                            const posName = parts.length > 1 ? parts.slice(1).join('__') : null;
                            const opt = posName
                                ? (vacancyGapBandOptions.find((o) => o.code === code && o.positionName === posName) || vacancyGapBandOptions.find((o) => o.code === code))
                                : vacancyGapBandOptions.find((o) => o.code === code);
                            if (opt) {
                                return buildTitularVacancyFromGapOption(
                                    opt,
                                    'user_selected',
                                    'Turno a cubrir elegido manualmente',
                                );
                            }
                        }
                        return null;
                    })();
                    const splitWorkBand = splitTitularShift
                        ? { code: splitTitularShift.code, positionName: splitTitularShift.positionName }
                        : null;
                    const splitPlan = splitTitularShift
                        ? describeVacancySplitPlan(splitTitularShift, vacancySplitListCtx.positionStructure)
                        : null;
                    const splitGapBand = splitPlan?.effectiveGapBand ?? splitWorkBand?.code ?? '';
                    const splitNeighbors = splitPlan
                        ? { extensionBand: splitPlan.extBand, earlyStartBand: splitPlan.adelBand }
                        : (splitWorkBand
                            ? neighborBandsForTargetAtPosition(
                                splitWorkBand.code,
                                vacancySplitListCtx.positionStructure,
                                splitWorkBand.positionName,
                            )
                            : null);
                    const splitListCtxWithGap = splitWorkBand
                        ? { ...vacancySplitListCtx, gapPositionName: splitWorkBand.positionName, gapBand: splitGapBand }
                        : vacancySplitListCtx;
                    const splitWorkerPoolExt = splitWorkBand && splitReferenceDate
                        ? listExtensionCandidates(
                            splitGapBand || splitWorkBand.code,
                            splitReferenceDate,
                            selectedObjective,
                            employees,
                            shiftsMap,
                            pendingChanges,
                            [vacancyData?.employeeId].filter(Boolean) as string[],
                            splitListCtxWithGap,
                        )
                            .filter((c) => {
                                const want = String(splitPlan?.extBand || splitNeighbors?.extensionBand || '').toUpperCase();
                                if (!want) return true;
                                return String(c.code || '').toUpperCase() === want;
                            })
                            .filter((c) => !q || c.name.toLowerCase().includes(q))
                        : [];
                    const splitWorkerPoolAdel = splitWorkBand && splitReferenceDate
                        ? listEarlyStartCandidates(
                            splitGapBand || splitWorkBand.code,
                            splitReferenceDate,
                            selectedObjective,
                            employees,
                            shiftsMap,
                            pendingChanges,
                            [vacancyData?.employeeId, vacancySplitExtId].filter(Boolean) as string[],
                            splitListCtxWithGap,
                        )
                            .filter((c) => {
                                const want = String(splitPlan?.adelBand || splitNeighbors?.earlyStartBand || '').toUpperCase();
                                if (!want) return true;
                                return String(c.code || '').toUpperCase() === want;
                            })
                            .filter((c) => !q || c.name.toLowerCase().includes(q))
                        : [];
                    const splitManualExtraHours = vacancySplitUsesManualExtraHours({
                        extExtraHours: vacancySplitExtExtraHours,
                        secondExtExtraHours: vacancySplitSecondExtraHours,
                    });
                    const splitDualPreview = (() => {
                        if (!splitWorkBand || !vacancySplitExtId || !vacancySplitAdelId) return null;
                        const extC = splitWorkerPoolExt.find((c) => c.id === vacancySplitExtId)
                            || splitWorkerPoolAdel.find((c) => c.id === vacancySplitExtId);
                        const adelC = splitWorkerPoolAdel.find((c) => c.id === vacancySplitAdelId);
                        if (!extC || !adelC) return null;
                        return resolveVacancySplitSegmentTimes(
                            vacancyPosSla,
                            splitGapBand,
                            splitWorkBand.positionName,
                            { positionName: extC.positionName, code: extC.code },
                            { positionName: adelC.positionName, code: adelC.code },
                            vacancySplitExtExtraHours,
                            vacancySplitSecondExtraHours,
                        );
                    })();
                    const splitExtSegmentLabel = splitDualPreview
                        ? `${splitDualPreview.first.from}–${splitDualPreview.first.to}`
                        : (splitPlan?.extSegment ?? '—');
                    const splitSecondSegmentLabel = splitDualPreview
                        ? `${splitDualPreview.second.from}–${splitDualPreview.second.to}`
                        : (splitPlan?.adelSegment ?? '—');
                    const splitFrancoPreview = (vacancySplitExtId && vacancySplitAdelId)
                        ? (() => {
                            const previewDays = shouldApplyCoverageToAllDays()
                                ? sortedActiveDates
                                : (vacancyEditingDay ? [vacancyEditingDay] : sortedActiveDates);
                            const rows: FrancoCoverageConflict[] = [];
                            for (const d of previewDays) {
                                rows.push(
                                    ...collectSplitFrancoConflicts(
                                        d,
                                        vacancySplitExtId,
                                        vacancySplitAdelId,
                                        vacancyEmployeesById,
                                        shiftsMap,
                                        pendingChanges,
                                    ),
                                );
                            }
                            return rows;
                        })()
                        : [];
                    const editingDayCov = vacancyEditingDay ? vacancyDayCoverages[vacancyEditingDay] : undefined;
                    const editingDaySubstituteId = vacancyEditingDay
                        ? (editingDayCov?.mode === 'substitute' ? editingDayCov.employeeId : selectedReplacement)
                        : selectedReplacement;
                    const selectedReplacementEmp = candidatos.find(e => e.id === editingDaySubstituteId);
                    const applySplitCoverage = () => {
                        if (!vacancySplitExtId || !vacancySplitAdelId) return;
                        if (vacancySplitExtId === vacancySplitAdelId) {
                            toast.error('Extensión y adelanto deben ser guardias distintos.');
                            return;
                        }
                        const applyAll = shouldApplyCoverageToAllDays();
                        const targetDays = applyAll
                            ? sortedActiveDates
                            : (vacancyEditingDay ? [vacancyEditingDay] : sortedActiveDates);
                        if (targetDays.length === 0) return;

                        const commitSplitPatch = () => {
                            const patch: Record<string, VacancyDayCoverage> = {};
                            let applied = 0;
                            for (const d of targetDays) {
                                const tit = resolveTitularForCoverageDay(d, splitReferenceDate || sortedActiveDates[0] || undefined);
                                if (!tit) continue;
                                patch[d] = {
                                    mode: 'split',
                                    extEmpId: vacancySplitExtId,
                                    adelEmpId: vacancySplitAdelId,
                                    gapBand: tit.code,
                                    gapPosition: tit.positionName,
                                    ...(splitManualExtraHours
                                        ? {
                                            extExtraHours: vacancySplitExtExtraHours,
                                            secondExtExtraHours: vacancySplitSecondExtraHours,
                                        }
                                        : {}),
                                };
                                applied++;
                            }
                            if (applied === 0) {
                                toast.error('No se pudo inferir el turno del titular en ningún día seleccionado.');
                                return;
                            }
                            setVacancyDayCoverages((prev) => ({ ...prev, ...patch }));
                            toast.success(`Ext+adel aplicado a ${applied} día(s).`);
                            setVacancyEditingDay(null);
                            setVacancyReplacementOpen(false);
                            setVacancyReplacementSearch('');
                        };

                        const francoConflicts: FrancoCoverageConflict[] = [];
                        for (const d of targetDays) {
                            francoConflicts.push(
                                ...collectSplitFrancoConflicts(
                                    d,
                                    vacancySplitExtId,
                                    vacancySplitAdelId,
                                    vacancyEmployeesById,
                                    shiftsMap,
                                    pendingChanges,
                                ),
                            );
                        }
                        if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
                            requestSupervisorFrancoAuth(francoConflicts, () => {
                                setVacancyFrancoAuthApproved(true);
                                commitSplitPatch();
                            }, 'extensión + adelanto');
                            return;
                        }
                        if (francoConflicts.length > 0) setVacancyFrancoAuthApproved(true);
                        commitSplitPatch();
                    };
                    const applySubstituteToActiveDays = (employeeId: string) => {
                        const applyAll = shouldApplyCoverageToAllDays();
                        const targetDays = applyAll
                            ? sortedActiveDates
                            : (vacancyEditingDay ? [vacancyEditingDay] : []);

                        const commitSubstitute = () => {
                            if (applyAll) {
                                setSelectedReplacement(employeeId);
                                setVacancyDayCoverages((prev) => {
                                    const next = { ...prev };
                                    for (const d of sortedActiveDates) {
                                        next[d] = { mode: 'substitute', employeeId };
                                    }
                                    return next;
                                });
                                toast.success(`Suplente asignado a ${sortedActiveDates.length} día(s).`);
                            } else if (vacancyEditingDay) {
                                setVacancyDayCoverages((prev) => ({ ...prev, [vacancyEditingDay]: { mode: 'substitute', employeeId } }));
                            } else {
                                setSelectedReplacement(employeeId);
                            }
                            setVacancyEditingDay(null);
                        };

                        if (targetDays.length > 0) {
                            const francoConflicts = collectVacancyFrancoConflicts({
                                days: targetDays.map((dateStr) => ({
                                    dateStr,
                                    coverage: { mode: 'substitute' as const, employeeId, employeeName: vacancyEmployeesById[employeeId]?.name || '' },
                                })),
                                shiftsMap,
                                employeesById: vacancyEmployeesById,
                            }, pendingChanges);
                            if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
                                requestSupervisorFrancoAuth(francoConflicts, () => {
                                    setVacancyFrancoAuthApproved(true);
                                    commitSubstitute();
                                }, 'suplencia sobre franco');
                                return;
                            }
                            if (francoConflicts.length > 0) setVacancyFrancoAuthApproved(true);
                        }
                        commitSubstitute();
                    };
                    const clearCoverageForScope = () => {
                        const applyAll = shouldApplyCoverageToAllDays();
                        if (applyAll) {
                            setSelectedReplacement('');
                            setVacancyDayCoverages((prev) => {
                                const next = { ...prev };
                                for (const d of sortedActiveDates) delete next[d];
                                return next;
                            });
                        } else if (vacancyEditingDay) {
                            setVacancyDayCoverages((prev) => {
                                const next = { ...prev };
                                delete next[vacancyEditingDay];
                                return next;
                            });
                            setVacancyEditingDay(null);
                        } else {
                            setSelectedReplacement('');
                        }
                    };
                    const renderVacancyCandidate = (e: typeof candidatos[0], suffix: string) => (
                        <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                                applySubstituteToActiveDays(e.id);
                                setVacancyReplacementOpen(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-indigo-50 rounded-lg ${editingDaySubstituteId === e.id ? 'bg-indigo-50 ring-1 ring-indigo-300' : ''}`}
                        >
                            <span className="font-bold truncate flex-1 min-w-0">{e.expBadge} {e.name}</span>
                            {formatKmLabel(e.km) && (
                                <span className="text-[10px] text-slate-400 font-mono shrink-0 flex items-center gap-0.5">
                                    <MapPin size={10} />{formatKmLabel(e.km)}
                                </span>
                            )}
                            <span className="text-[10px] text-slate-400 shrink-0">{suffix}</span>
                        </button>
                    );
                    return (
                    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 bg-black/25 backdrop-blur-[2px]">
                        <div className={`bg-white p-6 rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[min(92vh,820px)] flex flex-col border-l-4 ${colorMap[color].split(' ')[0]}`}>
                            <div className="flex items-start justify-between mb-4 shrink-0">
                                <div>
                                    <h3 className="font-black text-lg text-slate-800">{title}</h3>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        <span className="font-bold text-slate-700">{vacancyData?.employeeName}</span>
                                        {vacancyData?.startDate && <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{vacancyData.startDate} → {vacancyData.endDate}</span>}
                                    </p>
                                </div>
                                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${colorMap[color]}`}>{absType}</span>
                            </div>
                            <p className="text-xs text-slate-400 mb-3 shrink-0">{hint}</p>
                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-3 mb-4">
                            {absenceDateRange.length > 1 && (
                                <div className="mb-3 shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-[10px] font-black uppercase text-slate-400">Días a procesar</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => { setVacancyActiveDates(new Set(absenceDateRange)); setVacancyEditingDay(null); setVacancyApplyToAllSelected(true); setVacancyReplacementOpen(true); }} className="text-[10px] font-bold text-indigo-600 hover:underline">Todos</button>
                                            <button type="button" onClick={() => setVacancyActiveDates(new Set())} className="text-[10px] font-bold text-slate-400 hover:underline">Ninguno</button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                                        {absenceDateRange.map((d) => (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => toggleVacancyDate(d)}
                                                className={`px-2 py-1 rounded-lg text-[11px] font-bold font-mono border transition-colors ${vacancyActiveDates.has(d) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-300'}`}
                                            >
                                                {formatShortDay(d)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {vacancyActiveDates.size > 0 && (
                                <div className="mb-3 shrink-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-[10px] font-black uppercase text-slate-400">Cobertura por día</label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setVacancyEditingDay(null);
                                                setVacancyApplyToAllSelected(true);
                                                setVacancyPickerTab('substitute');
                                                setVacancyReplacementOpen(true);
                                            }}
                                            className="text-[10px] font-bold text-indigo-600 hover:underline"
                                        >
                                            Misma cobertura para todos
                                        </button>
                                    </div>
                                    {vacancyEmptyActiveDays > 0 && vacancyConfiguredDays > 0 && (
                                        <button
                                            type="button"
                                            onClick={replicateCoverageToEmptyDays}
                                            className="mb-2 w-full py-2 rounded-xl border border-violet-200 bg-violet-50 text-[10px] font-black text-violet-800 hover:bg-violet-100"
                                        >
                                            Completar {vacancyEmptyActiveDays} día(s) restante(s) con la misma cobertura
                                        </button>
                                    )}
                                    <p className="text-[10px] font-bold text-indigo-600 mb-2">
                                        <strong>Misma cobertura para todos</strong> aplica suplente o ext+adel a todos los días marcados. Tocá un día sólo si necesitás excepciones.
                                    </p>
                                    <div className="max-h-36 overflow-y-auto custom-scrollbar border rounded-xl divide-y">
                                        {[...vacancyActiveDates].sort().map((d) => {
                                            const cov = resolveDayCoverageForUi(d);
                                            const isEditing = vacancyEditingDay === d;
                                            return (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    onClick={() => openDayCoveragePicker(d)}
                                                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-colors ${isEditing ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-300' : 'hover:bg-slate-50'}`}
                                                >
                                                    <span className="font-mono font-black text-slate-700 w-14 shrink-0">{formatShortDay(d)}</span>
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block truncate font-bold text-slate-700">{resolveDayCoverageLabel(d)}</span>
                                                        {(() => {
                                                            const tit = resolveEffectiveTitularForDay(d);
                                                            return tit ? (
                                                                <span className="block truncate text-[9px] font-bold text-amber-700 mt-0.5">
                                                                    Cubrir: {renderTitularChipLine(tit)}
                                                                </span>
                                                            ) : (
                                                                <span className="block text-[9px] font-bold text-rose-500 mt-0.5">Sin turno laboral inferido</span>
                                                            );
                                                        })()}
                                                    </span>
                                                    {cov.mode === 'split' && (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 shrink-0">ext+adel</span>
                                                    )}
                                                    {cov.mode === 'substitute' && (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 shrink-0">suplente</span>
                                                    )}
                                                    <ChevronRight size={14} className={`shrink-0 ${isEditing ? 'text-indigo-600' : 'text-slate-300'}`} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {(vacancyReplacementOpen && (vacancyEditingDay || vacancyActiveDates.size > 0)) && (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-4 shrink-0 space-y-3">
                                <label className="text-[10px] font-black uppercase text-slate-400 block">
                                    {vacancyEditingDay
                                        ? `Configurar ${formatShortDay(vacancyEditingDay)}`
                                        : `Cobertura para todos los días (${vacancyActiveDates.size})`}
                                </label>
                                {(vacancyEditingDay || isBulkCoverageMode) && sortedActiveDates.length > 1 && (
                                    <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
                                        <input
                                            type="checkbox"
                                            checked={vacancyApplyToAllSelected || isBulkCoverageMode}
                                            disabled={isBulkCoverageMode}
                                            onChange={(e) => setVacancyApplyToAllSelected(e.target.checked)}
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-[10px] font-bold text-indigo-900">
                                            Aplicar a los {sortedActiveDates.length} días seleccionados
                                        </span>
                                    </label>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && splitTitularShift && (
                                    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 px-3 py-3">
                                        <div className="text-[10px] font-black uppercase text-amber-900 mb-1.5 flex items-center gap-1">
                                            <Clock size={11} /> Hueco de cobertura (turno SLA)
                                            {isBulkCoverageMode && splitReferenceDate && (
                                                <span className="normal-case font-bold text-amber-700/80 ml-1">· ref. {formatShortDay(splitReferenceDate)}</span>
                                            )}
                                        </div>
                                        {vacancyGapBandOptions.length > 0 && (
                                            <label className="block mb-2">
                                                <span className="text-[9px] font-black uppercase text-amber-800/90">¿Qué turno cubrir?</span>
                                                <select
                                                    className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 shadow-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-400"
                                                    value={vacancyGapBandOverride ?? `${splitTitularShift.code}__${splitTitularShift.positionName}`}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        const autoKey = `${splitTitularShift.code}__${splitTitularShift.positionName}`;
                                                        setVacancyGapBandOverride(v && v !== autoKey ? v : null);
                                                    }}
                                                >
                                                    {vacancyGapBandOptions.map((opt) => (
                                                        <option key={`${opt.code}__${opt.positionName}`} value={`${opt.code}__${opt.positionName}`}>
                                                            {opt.code} · {opt.positionName} · {opt.scheduleLabel} ({opt.hours}h)
                                                        </option>
                                                    ))}
                                                </select>
                                                <span className="text-[9px] font-bold text-amber-800/80 mt-1 block">
                                                    Si el cronograma muestra otro código (ej. S), elegí la banda real del SLA (ej. E3 14:00–20:00).
                                                </span>
                                            </label>
                                        )}
                                        <div className="text-sm font-black text-slate-800 flex flex-wrap items-center gap-1.5">
                                            <span className="font-mono bg-white px-2 py-0.5 rounded-lg border border-amber-300 text-amber-900">{splitTitularShift.code}</span>
                                            {splitTitularShift.bandLabel !== splitTitularShift.code && (
                                                <span>{splitTitularShift.bandLabel}</span>
                                            )}
                                            <span className="text-slate-400">·</span>
                                            <span>{splitTitularShift.positionName}</span>
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-600 mt-1">
                                            {splitTitularShift.scheduleLabel !== '—' ? (
                                                <>{splitTitularShift.scheduleLabel} · {splitTitularShift.hours}h</>
                                            ) : (
                                                <>{splitTitularShift.hours}h · horario según cronograma</>
                                            )}
                                        </div>
                                        <div className="text-[9px] font-bold text-amber-800/90 mt-1">{splitTitularShift.sourceLabel}</div>
                                        {vacancyPickerTab === 'split' && splitPlan && (
                                            <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] font-bold text-violet-900">
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Hueco</div>
                                                    <div>{splitPlan.gapLabel}</div>
                                                </div>
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Ext · {splitPlan.extBand}</div>
                                                    <div>{splitPlan.extSegment}</div>
                                                </div>
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Adel · {splitPlan.adelBand}</div>
                                                    <div>{splitPlan.adelSegment}</div>
                                                </div>
                                            </div>
                                        )}
                                        {vacancyPickerTab === 'substitute' && (
                                            <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 text-[9px] font-bold text-teal-800">
                                                El suplente heredará turno <strong>{splitTitularShift.code}</strong> en <strong>{splitTitularShift.positionName}</strong>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && vacancyGapBandOptions.length > 0 && !splitTitularShift && (
                                    <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-3">
                                        <label className="block">
                                            <span className="text-[10px] font-black uppercase text-amber-900 flex items-center gap-1 mb-1">
                                                <Clock size={11} /> Elegí el turno SLA a cubrir
                                            </span>
                                            <select
                                                className="w-full rounded-xl border border-amber-300 bg-white px-2.5 py-2 text-xs font-bold text-slate-800 shadow-sm"
                                                value={vacancyGapBandOverride ?? ''}
                                                onChange={(e) => setVacancyGapBandOverride(e.target.value || null)}
                                            >
                                                <option value="">— Seleccionar banda (ej. E3 14:00–20:00) —</option>
                                                {vacancyGapBandOptions.map((opt) => (
                                                    <option key={`${opt.code}__${opt.positionName}`} value={`${opt.code}__${opt.positionName}`}>
                                                        {opt.code} · {opt.positionName} · {opt.scheduleLabel}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setVacancyPickerTab('substitute')}
                                            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-colors ${vacancyPickerTab === 'substitute' ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-200'}`}
                                        >
                                            Traer suplente
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setVacancyPickerTab('split')}
                                            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border flex items-center justify-center gap-1 transition-colors ${vacancyPickerTab === 'split' ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-200'}`}
                                        >
                                            <Split size={12} /> Ext + Adel
                                        </button>
                                    </div>
                                )}
                                {isBulkCoverageMode && (
                                    <p className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                                        La configuración se aplicará a los {vacancyActiveDates.size} días seleccionados arriba.
                                    </p>
                                )}
                                {vacancyPickerTab === 'substitute' && (
                                    <div ref={vacancyReplacementPanelRef} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                        <p className="text-[10px] font-bold text-teal-800 bg-teal-50 border-b border-teal-100 px-3 py-2">
                                            Preferí <strong>RET</strong>, <strong>ESC</strong> o guardias <strong>sin turno</strong> — evitás franco trabajado (FT) y costo extra.
                                        </p>
                                        <div className="p-2 border-b bg-white">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    className="w-full pl-9 pr-3 py-2.5 text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-400"
                                                    placeholder="Buscar por nombre o legajo..."
                                                    value={vacancyReplacementSearch}
                                                    onChange={e => setVacancyReplacementSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="overflow-y-auto custom-scrollbar p-1 max-h-[min(38vh,260px)]">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    clearCoverageForScope();
                                                    setVacancyReplacementOpen(false);
                                                }}
                                                className={`w-full px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50 rounded-lg ${!vacancyDayHasCoverage(vacancyEditingDay ? resolveDayCoverageForUi(vacancyEditingDay) : (selectedReplacement ? { mode: 'substitute', employeeId: selectedReplacement } : { mode: 'none' })) ? 'bg-slate-50 ring-1 ring-slate-300 text-slate-500' : 'text-slate-400'}`}
                                            >
                                                Sin cobertura — dejar vacante
                                            </button>
                                            {retenCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-amber-600">Retén — más cerca primero ({retenCandidatos.length})</div>
                                                    {retenCandidatos.map(e => renderVacancyCandidate(e, `Retén · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {escCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-sky-600">ESC — más cerca primero ({escCandidatos.length})</div>
                                                    {escCandidatos.map(e => renderVacancyCandidate(e, `ESC · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {sinTurnoCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-emerald-600">Sin turno — más cerca primero ({sinTurnoCandidatos.length})</div>
                                                    {sinTurnoCandidatos.map(e => renderVacancyCandidate(e, `Libre · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {retenCandidatos.length === 0 && escCandidatos.length === 0 && sinTurnoCandidatos.length === 0 && (
                                                <p className="px-3 py-6 text-xs text-slate-400 text-center">
                                                    {q ? `Sin resultados para "${vacancyReplacementSearch}"` : 'No hay RET, ESC ni guardias libres ese día cerca del objetivo.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {vacancyPickerTab === 'split' && (vacancyEditingDay || isBulkCoverageMode) && (
                                    <div ref={vacancyReplacementPanelRef} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 space-y-3">
                                        {!splitTitularShift ? (
                                            <p className="text-xs text-slate-400 text-center py-4">
                                                No se pudo inferir la banda a cubrir. Revisá el turno habitual del titular en el cronograma.
                                            </p>
                                        ) : (
                                            <>
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                    <input
                                                        className="w-full pl-9 pr-3 py-2 text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-violet-400"
                                                        placeholder="Filtrar guardias..."
                                                        value={vacancyReplacementSearch}
                                                        onChange={e => setVacancyReplacementSearch(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                                                        1.er tramo — extensión ({splitExtSegmentLabel})
                                                    </label>
                                                    <p className="text-[9px] text-slate-400 font-bold mb-1.5">
                                                        Banda {splitPlan?.extBand || 'anterior'} del objetivo (cualquier puesto; primero el del hueco). El titular ausente no aparece.
                                                    </p>
                                                    <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 p-1">
                                                        {splitWorkerPoolExt.length === 0 ? (
                                                            <p className="text-[10px] text-slate-400 px-2 py-3 text-center">
                                                                No hay guardias en banda {splitPlan?.extBand || 'anterior'} ese día en el objetivo.
                                                            </p>
                                                        ) : splitWorkerPoolExt.map(c => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => setVacancySplitExtId(c.id)}
                                                                className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border transition-colors ${vacancySplitExtId === c.id ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                {c.name} · {c.code} · {c.positionName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                                                        2.º tramo — adelanto ({splitSecondSegmentLabel})
                                                    </label>
                                                    <p className="text-[9px] text-slate-400 font-bold mb-1.5">
                                                        Banda {splitPlan?.adelBand || 'posterior'} del objetivo (cualquier puesto; primero el del hueco).
                                                    </p>
                                                    <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 p-1">
                                                        {splitWorkerPoolAdel.length === 0 ? (
                                                            <p className="text-[10px] text-slate-400 px-2 py-3 text-center">
                                                                {vacancySplitExtId
                                                                    ? `No hay guardias en banda ${splitPlan?.adelBand || 'posterior'} ese día (distintos del 1.er tramo).`
                                                                    : `No hay guardias en banda ${splitPlan?.adelBand || 'posterior'} ese día en el objetivo.`}
                                                            </p>
                                                        ) : splitWorkerPoolAdel.map(c => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => setVacancySplitAdelId(c.id)}
                                                                className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border transition-colors ${vacancySplitAdelId === c.id ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                {c.name} · {c.code} · {c.positionName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2.5 space-y-2">
                                                    <div className="text-[10px] font-black uppercase text-violet-900">Horas de extensión</div>
                                                    <p className="text-[9px] font-bold text-violet-800/90">
                                                        {splitManualExtraHours
                                                            ? `Manual: +${vacancySplitExtExtraHours}h y +${vacancySplitSecondExtraHours}h sobre el fin SLA de cada guardia.`
                                                            : 'Auto: tramos según hueco SLA (corte entre bandas).'}
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setVacancySplitExtExtraHours(null);
                                                                setVacancySplitSecondExtraHours(null);
                                                            }}
                                                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${!splitManualExtraHours ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
                                                        >
                                                            Auto SLA
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setVacancySplitExtExtraHours(2);
                                                                setVacancySplitSecondExtraHours(4);
                                                            }}
                                                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border ${splitManualExtraHours && vacancySplitExtExtraHours === 2 && vacancySplitSecondExtraHours === 4 ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:border-red-200'}`}
                                                        >
                                                            +2h / +4h
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <label className="text-[9px] font-bold text-slate-600">
                                                            1.er guardia (+h)
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={12}
                                                                step={0.5}
                                                                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                                                                placeholder="Auto"
                                                                value={vacancySplitExtExtraHours ?? ''}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value.trim();
                                                                    if (!raw) {
                                                                        setVacancySplitExtExtraHours(null);
                                                                        return;
                                                                    }
                                                                    const n = Number(raw);
                                                                    setVacancySplitExtExtraHours(Number.isFinite(n) ? n : null);
                                                                }}
                                                            />
                                                        </label>
                                                        <label className="text-[9px] font-bold text-slate-600">
                                                            2.º guardia (+h)
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={12}
                                                                step={0.5}
                                                                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold"
                                                                placeholder="Auto"
                                                                value={vacancySplitSecondExtraHours ?? ''}
                                                                onChange={(e) => {
                                                                    const raw = e.target.value.trim();
                                                                    if (!raw) {
                                                                        setVacancySplitSecondExtraHours(null);
                                                                        return;
                                                                    }
                                                                    const n = Number(raw);
                                                                    setVacancySplitSecondExtraHours(Number.isFinite(n) ? n : null);
                                                                }}
                                                            />
                                                        </label>
                                                    </div>
                                                    {splitDualPreview && (
                                                        <div className="text-[9px] font-bold text-violet-900 pt-1 border-t border-violet-200/80">
                                                            Hueco {splitDualPreview.gap.from}–{splitDualPreview.gap.to}
                                                            {' · '}
                                                            1.º {splitDualPreview.first.from}–{splitDualPreview.first.to}
                                                            {' · '}
                                                            2.º {splitDualPreview.second.from}–{splitDualPreview.second.to}
                                                        </div>
                                                    )}
                                                </div>
                                                {splitFrancoPreview.length > 0 && (
                                                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-[10px] font-bold text-amber-900">
                                                        <div className="flex items-center gap-1.5 mb-1 text-amber-800">
                                                            <AlertTriangle size={12} /> Franco planificado — costo FT
                                                        </div>
                                                        <p className="leading-relaxed">
                                                            {formatFrancoConflictSummary(splitFrancoPreview)}.
                                                            Requiere <strong>PIN de supervisor</strong> o elegí guardias en servicio / RET / ESC (pestaña suplente).
                                                        </p>
                                                    </div>
                                                )}
                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => applySplitCoverage()}
                                                        disabled={!vacancySplitExtId || !vacancySplitAdelId}
                                                        className="w-full py-3 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40 hover:bg-violet-700 shadow-sm shadow-violet-200"
                                                    >
                                                        {splitApplyButtonLabel}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                                {vacancyEditingDay && (
                                    <div className="flex gap-2 pt-0.5 border-t border-slate-200/80">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const sorted = [...vacancyActiveDates].sort();
                                                const idx = sorted.indexOf(vacancyEditingDay);
                                                const next = sorted[idx + 1];
                                                if (next) openDayCoveragePicker(next);
                                                else {
                                                    setVacancyReplacementOpen(false);
                                                    setVacancyEditingDay(null);
                                                    setVacancyReplacementSearch('');
                                                }
                                            }}
                                            className="flex-1 py-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition-colors"
                                        >
                                            {(() => {
                                                const sorted = [...vacancyActiveDates].sort();
                                                const idx = sorted.indexOf(vacancyEditingDay);
                                                return idx < sorted.length - 1 ? 'Siguiente día →' : 'Listo';
                                            })()}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setVacancyReplacementOpen(false); setVacancyReplacementSearch(''); setVacancyEditingDay(null); }}
                                            className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                )}
                            </div>
                            )}
                            </div>
                            <div className="flex gap-3 shrink-0">
                                <button onClick={finalizeVacancyModal} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-50 rounded-xl border">Cancelar</button>
                                <button onClick={handleProcessVacancy} disabled={vacancyActiveDates.size === 0} className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg disabled:opacity-40 ${btnColor[color]}`}>
                                    {willAssignAny ? 'Confirmar cobertura' : 'Marcar vacante'}
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 text-center mt-3 shrink-0">Los cambios quedan pendientes — recordá guardar el cronograma.</p>
                        </div>
                    </div>
                    );
}

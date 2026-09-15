import React, { useState, useEffect, useMemo, useRef, useTransition, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageHeader, SupervisorPinInput } from '@/components/ui';
import { openCronoPopout } from '@/lib/planificacion/openCronoPopout';
import { useSetPageHeader } from '@/context/PageHeaderContext';
import { 
    ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, Plus,
    Users, Clock, X, UserPlus, ArrowRight, Eye, EyeOff, 
    CheckCircle, Trash2, ShieldAlert, User, Briefcase, Layers,
    Bell, Calendar, CalendarX, Loader2, Stethoscope, MapPin, Lock, ShieldCheck, UserMinus,
    Save, Undo, History, MousePointer2, AlertTriangle, Grip, LayoutGrid, MonitorPlay,
    Printer, Download, Grid, RefreshCw, Edit3, Shield, ArrowRightCircle, Info, ArrowDownWideNarrow, ArrowDownAZ,
    BadgePercent, ArrowLeftRight, CalendarSearch, CheckSquare, XCircle, Search as SearchIcon, RefreshCcw, UserCheck, Split, Ban,
    FastForward, Rewind, AlertOctagon, Siren, FileText, Fingerprint, CalendarCheck, HelpCircle, MousePointerClick, Check, Database, Activity,
    PowerOff, LockKeyhole, Ghost, Maximize2, Maximize, Minimize2, Copy, ClipboardPaste, Scissors, Wand2, BarChart3, BarChart2, PanelLeft, LayoutList,
    ChevronsUp, ChevronsDown, MoreHorizontal, FlaskConical, Shuffle, Timer
} from 'lucide-react';

import { canAccessAutoLab } from '@/lib/planificacion/autoLabAccess';
import { canAssignFrancoTrabajado } from '@/lib/planificacion/francoTrabajadoAccess';
import { SwapSupervisorQueue } from '@/components/planificacion/SwapSupervisorQueue';
import { db, getDocsOnce, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { eventoService, eventosParaFecha, serviciosParaFecha, calcHorasEvento, type Evento, type ServicioEvento } from '@/services/eventoService';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp, where, getDocs, getDoc, updateDoc, writeBatch, setDoc, deleteField } from 'firebase/firestore';

import {
    ASSIGN_SEARCH_LIMIT,
    DOTACION_NEARBY_KM_DEFAULT,
    DOTACION_NEARBY_ROW_CAP,
    DOTACION_NEARBY_SCAN_CAP,
    NEARBY_KM_STORAGE_KEY,
    ROSTER_KM_PRESETS,
    clampNearbyKm,
    employeeKmToObjective,
    formatKmLabel,
    isEmpExcludedFromPlanningDotacion,
    readStoredNearbyKm,
    type PlanificacionDotacionMap,
} from '@/lib/planificacion/planificacionDotacionUtils';
import {
    DEFAULT_LIMITS,
    GRUPO_COLOR_HEX,
    LEGEND_DESCRIPTIONS,
    PLANNING_ENGINE_VERSION,
    SHIFT_HOURS_LOOKUP,
    SHIFT_RANGES,
    SHIFT_STYLES,
    absenceStatusBadgeClass,
    clampPlanifFloatingPos,
    getDefaultStyle,
} from '@/lib/planificacion/planificacionGridVisuals';
import { isPosActiveOnDay } from '@/lib/planificacion/planificacionPositionEngine';
import {
    dailyCoverageHoursTargetWithPerShiftPax,
    filterShiftsForPlanningDay,
    isPosExcludedOnDate,
} from '@/lib/planificacion/planificacionDailyCoverage';
import {
    calcShiftHours,
    is24hCoverageType,
    isShortBandHours,
    resolveBandHours,
} from '@/lib/planificacion/planificacionBandHours';
import { getDateKey, getDayLetter, isDateLocked } from '@/lib/planificacion/utils';
import { planificacionActionLabel } from '@/lib/planificacion/planificacionActionLabels';
import {
    PLANNING_TRACE_TONE,
    buildPlanningCellTrace,
    formatPlanningTraceTooltip,
} from '@/lib/planificacion/planificacionPlanningTrace';
import {
    formatPlanificacionTime,
    formatShiftScheduleLabel,
    resolveShiftDisplayClockParts,
} from '@/lib/planificacion/planificacionShiftDisplay';
import {
    OTHER_OBJECTIVE_CELL_STYLE,
    isCrossObjectivePlanningReadOnly,
    isOperationalOriginShift,
    isOpsCoverageShift,
    isPlanificacionPublished,
    isShiftAtOtherObjective,
    resolveCellShiftAtObjective,
    resolveCellShiftDisplay,
    shiftMatchesObjective,
    shiftPlanningCodeUpper,
    turnoCuentaParaCronoPlanificado,
} from '@/lib/planificacion/planificacionPlanningShiftRules';
import {
    LEAVE_CELL_CODES,
    resolveTitularCoverageName,
} from '@/lib/planificacion/planificacionTitularCoverage';
import { useEmpresa } from '@/context/EmpresaContext';
import {
    belongsToEmpresaView,
    shouldScopeQueriesToEmpresa,
    empresaCollectionQuery,
    buildAuditLogsRecentQuery,
    auditLogTimestampMs,
    sortAuditLogRows,
    filterRowsByEmpresa,
    dedupeClientsById,
    stampEmpresaId,
    buildPlanificacionEstadoDocId,
    planificacionPublishLookupKey,
} from '@/lib/multiempresa';
import { toYyyyMmDd } from '@/lib/firestoreDates';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';
import {
    isPlanningPositionExcludedOnDate,
    isPlanningShiftExcludedOnDate,
    getPlanningExcludedShiftCodesOnDate,
    getPlanningExcludedShiftPaxOnDate,
    isPlanningWorkShiftCode,
    planningPositionExclusionLabel,
    buildExcludedPositionsByDate,
    abbrevPlanningPositionName,
    excludedPositionsCellLabel,
    excludedPositionsTooltip,
} from '@/lib/slaPlanningMatch';
import { buildSlaExclusionContext, isTurnoOnSlaExcludedSlot } from '@/lib/crm/slaExclusionForPlanned';
import { resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';
import { useAuth } from '@/context/AuthContext';
import { usePlanificacionFirestore } from '@/hooks/usePlanificacionFirestore';
import { usePlanificacionGrupoSla } from '@/hooks/usePlanificacionGrupoSla';
import { usePlanificacionObjectiveSla } from '@/hooks/usePlanificacionObjectiveSla';
import { usePlanificacionAutoRotation } from '@/hooks/usePlanificacionAutoRotation';
import { usePlanificacionPublishState } from '@/hooks/usePlanificacionPublishState';
import { usePlanificacionDotacionOverlay } from '@/hooks/usePlanificacionDotacionOverlay';
import { usePlanificacionDotacionMigration } from '@/hooks/usePlanificacionDotacionMigration';
import { unpublishPlanificacionMonth } from '@/lib/planificacion/planificacionUnpublish';
import { publishPlanificacionMonth } from '@/lib/planificacion/planificacionPublish';
import {
    buildPublishConfirmModalState,
    evaluatePublishSlaState,
    type PublishConfirmModalState,
} from '@/lib/planificacion/planificacionPublishConfirm';
import { executePlanificacionSaveJob } from '@/lib/planificacion/executePlanificacionSaveJob';
import { loadPlanificacionCronogramaRefresh } from '@/lib/planificacion/refreshPlanificacionCronogramaView';
import {
    clearPlanificacionObjectivePositions,
    savePlanificacionEmpPosition,
} from '@/lib/planificacion/planificacionDotacionActions';
import {
    applyPlanificacionVacancyCoverage,
    buildVacancyProcessDays,
    collectPlanificacionVacancyFrancoConflicts,
    toastVacancyApplyError,
    toastVacancyApplyResult,
} from '@/lib/planificacion/processPlanificacionVacancy';
import { applyPlanificacionBulkChange } from '@/lib/planificacion/applyPlanificacionBulkChange';
import { applyPlanificacionBulkPositionFill } from '@/lib/planificacion/applyPlanificacionBulkPositionFill';
import {
    evaluatePlanificacionRestricciones,
    isPlanificacionBulkCovBlocked,
} from '@/lib/planificacion/planificacionRestricciones';
import { assignPlanificacionShift } from '@/lib/planificacion/assignPlanificacionShift';
import { applyPlanificacionToPending } from '@/lib/planificacion/applyPlanificacionToPending';
import { checkPlanificacionLaborRules } from '@/lib/planificacion/checkPlanificacionLaborRules';
import {
    confirmPlanificacionPendingAssignment,
    resetPlanificacionPendingAssignment,
} from '@/lib/planificacion/confirmPlanificacionPendingAssignment';
import { applyPlanificacionRecompositionPackage } from '@/lib/planificacion/applyPlanificacionRecompositionPackage';
import {
    executePlanificacionSwap,
    getPlanificacionShiftFor,
} from '@/lib/planificacion/executePlanificacionSwap';
import {
    copyPlanificacionSelectionToClipboard,
    cutPlanificacionSelection,
    pastePlanificacionClipboardAt,
} from '@/lib/planificacion/planificacionClipboard';
import { findPlanificacionConflictNeighbors } from '@/lib/planificacion/findPlanificacionConflictNeighbors';
import { resolvePlanificacionConflict } from '@/lib/planificacion/resolvePlanificacionConflict';
import { submitPlanificacionRRHHNovedad } from '@/lib/planificacion/submitPlanificacionRRHHNovedad';
import { resetPlanificacionVacancyModal } from '@/lib/planificacion/resetPlanificacionVacancyModal';
import { handlePlanificacionMouseUp } from '@/lib/planificacion/handlePlanificacionMouseUp';
import { applyPlanificacionPrevMonthTemplate } from '@/lib/planificacion/applyPlanificacionPrevMonthTemplate';
import {
    loadPlanificacionAbsencesForRange,
    mergePlanificacionAbsencesFromLocalGrid,
} from '@/lib/planificacion/loadPlanificacionAbsencesForRange';
import {
    applyPlanificacionContextChange,
    applyPlanificacionGrupoChange,
} from '@/lib/planificacion/planificacionContextNavigation';
import {
    deletePlanificacionGrupo,
    savePlanificacionGrupo,
} from '@/lib/planificacion/planificacionGrupoCrud';
import {
    generatePlanificacionAutoScheduleV2,
} from '@/lib/planificacion/generatePlanificacionAutoScheduleV2';
import { applyPlanificacionAutoScheduleV2 } from '@/lib/planificacion/applyPlanificacionAutoScheduleV2';
import { runPlanificacionAutoV2PlanningAgentGemini } from '@/lib/planificacion/runPlanificacionAutoV2PlanningAgentGemini';
import {
    applyPlanificacionCoverageToStats,
    rebalancePlanificacionAutoForm,
    reprocessPlanificacionAutoIssues,
} from '@/lib/planificacion/planificacionAutoV2PostProcess';
import { fetchPlanificacionSlaDebug } from '@/lib/planificacion/fetchPlanificacionSlaDebug';
import { applyPlanificacionColumnCopy } from '@/lib/planificacion/applyPlanificacionColumnCopy';
import { isShiftConsolidated, rfzDocToShiftView } from '@/lib/planificacion/planificacionShiftViewUtils';
import { toast } from 'sonner';
import {
    planToastBulk,
    planToastSaving,
    planToastWarnMany,
} from '@/lib/planificacion/planToast';
import { checkRestBetweenShifts } from '@/lib/planificacion/restBetweenShifts';
import { applyServiceExcludedDays } from '@/lib/planificacion/absenceFrancoUtils';
import { generateScheduleV4 } from '@/lib/planificacion/autoScheduleEngineV4';
import { runPlanningGeneration, resolvePlanningGenerationRoute } from '@/lib/planificacion/planningGenerationRouter';
import { resolveObjectiveScheduleFlags, shouldBypassFixedBandFloater } from '@/lib/planificacion/scheduleObjectiveFlags';
import {
    buildObjectiveScheduleProfile,
    buildObjectiveServiceAnalysis,
    formatObjectiveCycleBlocksSummary,
    objectiveIsMixedSchedule,
} from '@/lib/planificacion/objectiveServiceModel';
import ObjectiveServiceAnalysisCard from '@/components/planificacion/ObjectiveServiceAnalysisCard';
import { resolveCronogramPlanningRules } from '@/lib/planificacion/cronogramPlanningRules';
import { dominantDotacionFromPlanningCells } from '@/lib/planificacion/seedDotacionFromPrevMonth';
import { fetchPlanningMonthShifts, buildPlanningMonthTurnosQuery, buildPlanningMonthRfzQuery, buildPlanningMonthTuraQuery } from '@/lib/planificacion/loadPlanningMonthShifts';
import { matchesEmployeeSearch } from '@/lib/planificacion/employeeSearch';
import {
    adjacentPlanningMonths,
    getCachedPlanningMonth,
    planningMonthCacheKey,
    setCachedPlanningMonth,
} from '@/lib/planificacion/planningMonthCache';
import { planningMonthAccess, classifyYearMonth } from '@/lib/dataRetention';
import { ingestPlanningTurnosSnapshot } from '@/lib/planificacion/planningTurnosIngest';
import {
    buildPlanningEventosCellsByDay,
    formatPlanningEventosTooltip,
} from '@/lib/planificacion/planningEventosExtras';
import { formatShiftClockRange, isTuraContiguousToParent } from '@/lib/refuerzo/turaContiguity';
import {
    compareObjectiveMonthSchedules,
    formatCompareObjectiveMonthsReport,
} from '@/lib/planificacion/compareObjectiveMonthSchedules';
import {
    resolveAutoPlanningBrain,
    PLANNING_COVERAGE_RULES,
    type AutoPlanningBrainResult,
} from '@/lib/planificacion/autoPlanningBrain';
import { applySlaContractDotacion, buildPositionAssignmentsByEmp, buildSlaRotationByDate } from '@/lib/planificacion/slaContractPlanning';
import { isEncargadoPosition } from '@/lib/servicios/encargadoPosition';
import { isEventosPosition } from '@/lib/servicios/eventosPosition';
import { positionIncludeInSlaTotals } from '@/lib/servicios/auxiliaryPositionPolicy';
import { calculatePositionMonthHours } from '@/lib/servicios/slaHoursCalculator';
import {
    countPositionClosedUnitsFromShifts,
    is24hsSinglePaxBandMixBlocked,
    PLANNING_NON_BILLABLE_CODES,
    buildCodeCountsByPositionForDay,
    collectSplitBandCreditsForDay,
    lookupSplitCreditsForPosition,
} from '@/lib/planificacion/positionCoverageUnits';
import {
    analyzeDayCoverageGaps,
    analyzeObjectiveCoverageGaps,
    flattenDayGapsForUi,
    inferGapBandForClose,
} from '@/lib/planificacion/coverageGapAnalysis';
import {
    buildObjectiveCoveragePreflight,
    type ObjectiveCoveragePreflight,
} from '@/lib/planificacion/objectiveCoverageDemand';
import { inferAbsenceCode, absenceGridDisplayCode } from '@/lib/planificacion/absenceCodes';
import { isEmployeeOnLeave, shouldShowLeaveConflictSiren } from '@/lib/planificacion/leaveCoverage';
import {
    listDateRangeInclusive,
    applyVacancyCoverageToChanges,
    collectVacancyFrancoConflicts,
    VACANCY_NON_WORK_CODES,
    resolveVacancyDayCoverage,
    formatVacancyDayCoverageLabel,
    vacancyDayHasCoverage,
    resolveTitularVacancyWorkShift,
    describeVacancySplitPlan,
    resolveVacancySplitSegmentTimes,
    vacancySplitUsesManualExtraHours,
    VACANCY_BAND_SCHEDULE,
    type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import { alignVacancyGapBand } from '@/lib/planificacion/vacancySplitBands';
import {
    listVacancyGapBandOptions,
    inferTitularGapBandFromHistory,
    resolveEffectiveVacancyGapTitular,
    buildTitularVacancyFromGapOption,
} from '@/lib/planificacion/vacancyGapBands';
import { resolveCellSecondBlock, slaBlocksForPositionShift } from '@/lib/planificacion/splitShiftDisplay';
import {
    listExtensionCandidates,
    listEarlyStartCandidates,
    defaultSplitForBand,
    defaultSplitForBandAtPosition,
    neighborBandsForTarget,
    neighborBandsForTargetAtPosition,
    collectSplitFrancoConflicts,
    formatFrancoConflictSummary,
    resolveEmployeeShift,
    type FrancoCoverageConflict,
} from '@/lib/planificacion/planningRecompositionApply';
import { verifyScheduleCoverage } from '@/lib/planificacion/coverageVerification';
import { analyzeCoveragePolicyBalance } from '@/lib/planificacion/coveragePolicyBalance';
import { evaluateScheduleClosure } from '@/lib/planificacion/scheduleClosureGate';
import { prepare24hsPlanningContext } from '@/lib/planificacion/planningOrchestrator24hs';
import { fetchCoverageWisdomHistory, DEFAULT_COVERAGE_WISDOM_LOOKBACK_MONTHS } from '@/lib/planificacion/fetchPlanningCoverageWisdomHistory';
import type { PlanningCoverageWisdom } from '@/lib/planificacion/planningCoverageWisdom';
import { runStrictSixTwoPipeline, runSixPlusOnePipeline } from '@/lib/planificacion/planningPipeline';
import { canUseFixedBandFloater } from '@/lib/planificacion/fixedBandFloaterScheduleEngine';
import { applyAbsenceCoverage } from '@/lib/planificacion/coverageEngine';
import PlanningCoverageModal from '@/components/planificacion/PlanningCoverageModal';
import PlanningCoverageVerificationModal from '@/components/planificacion/PlanningCoverageVerificationModal';
import PlanningCctCapacityModal from '@/components/planificacion/PlanningCctCapacityModal';
import PlanningHoursBreakdownModal from '@/components/planificacion/PlanningHoursBreakdownModal';
import PlanningGroupFormModal from '@/components/planificacion/PlanningGroupFormModal';
import { PlanningAutoScheduleModal } from '@/components/planificacion/PlanningAutoScheduleModal';
import PlanningRecompositionModal from '@/components/planificacion/PlanningRecompositionModal';
import PlanningSlaGapCloseModal, { type SlaGapCloseModalData } from '@/components/planificacion/PlanningSlaGapCloseModal';
import PlanningShiftExtendModal, { type ShiftExtendModalData } from '@/components/planificacion/PlanningShiftExtendModal';
import { isShiftEligibleForExtension } from '@/lib/planificacion/shiftExtensionApply';
import PlanningCronogramasOverviewModal from '@/components/planificacion/PlanningCronogramasOverviewModal';
import type { PendingAbsenceNovedad, RecompositionPackage } from '@/lib/planificacion/planningRecomposition.types';
import { canUseSixPlusOne } from '@/lib/planificacion/sixPlusOneEngine';
import { buildScheduleOptimizationSuggestions } from '@/lib/planificacion/scheduleOptimizationSuggestions';
import { type FormRebalanceLogEntry } from '@/lib/planificacion/scheduleFormRebalancer';
import AjustarCronoOperativoModal from '@/components/admin/planificacion/AjustarCronoOperativoModal';
import EquilibrarCronoModal from '@/components/admin/planificacion/EquilibrarCronoModal';
import { usePlanningRules } from '@/hooks/usePlanningRules';
import { enabledPlanningCycles, planningHourLimits } from '@/lib/planning/planning-rules.runtime';
import {
    buildPlanningSnapshotForKeys,
    buildPlanningSnapshotFromGrid,
    collectSnapshotEmployeeIds,
    diffPlanningSnapshots,
    isSparsePlanningSnapshot,
} from '@/lib/planificacion/planningSnapshotDiff';
import {
    buildDeploymentShiftConfig,
    cellLabelForDeployment,
    deploymentFieldsForFirestore,
    isDeploymentSurplusCode,
    shiftCountsForEmployeeCronoHours,
} from '@/lib/planificacion/deploymentRoles';
import { checkGeneroPuesto, getPreferenciaGeneroFromPositionStructure, getPreferenciaGeneroUi, preferenciaGeneroOptionSuffix, preferenciaGeneroLabel } from '@/lib/planificacion/genderPreference';
import { experienciaBadgeForReplacement } from '@/lib/planificacion/experienciaObjetivos';
import { gruposService, GrupoObjetivos } from '@/services/gruposService';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import {
    shiftCoverageExtensionExtraHours,
    calcPlanningBillableHoursAttributedToPosition,
    calcPlanningSlaReconciliationHours,
    planningShiftBillableBreakdown,
} from '@/lib/planificacion/planningScheduledHours';
import { computePlanningMonthHoursBreakdown } from '@/lib/planificacion/planningMonthHoursBreakdown';
import {
    billableHoursForPlanningCell,
    resolveTurnosForPlanningCellKey,
    slaBaseHoursForPlanningCell,
    type PlanningCellHoursContext,
} from '@/lib/planificacion/planningEmployeeCellHours';

const formatTime = formatPlanificacionTime;

interface Coords { r: number; c: number; }

export default function PlanificacionPage() {
    const { empresaId, empresa, loadingEmpresa } = useEmpresa();
    const { rules: planningRules } = usePlanningRules(empresaId);
    const planningLimits = useMemo(
        () => planningHourLimits(planningRules),
        [planningRules],
    );
    const router = useRouter();
    const { isSuperAdmin, rolePermissions, loading: sessionAuthLoading, user: authUser } = useAuth();
    const canPublishPlanning = isSuperAdmin || (rolePermissions['PLANNING'] || []).includes('publish');
    const canCorrectPlanning = isSuperAdmin || (rolePermissions['PLANNING'] || []).includes('correct');
    const canAutoLab = canAccessAutoLab(isSuperAdmin, rolePermissions);
    const canAssignFT = canAssignFrancoTrabajado(isSuperAdmin, rolePermissions);
    const migracionCompleta = (empresa as any)?.migracionCompleta === true;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    // ============================================================================
    // 1. ESTADOS (NIVEL 0)
    // ============================================================================
    const [currentDate, setCurrentDate] = useState(new Date());
    const goToPlanningMonth = useCallback((year: number, monthIndex0: number) => {
        const month = monthIndex0 + 1;
        const access = planningMonthAccess(year, month);
        if (!access.allowed) {
            toast.error(access.message);
            return false;
        }
        if (access.tier === 'warm' && access.message) {
            toast.message(access.message);
        }
        setCurrentDate(new Date(year, monthIndex0, 1));
        return true;
    }, []);
    const planningMonthTier = useMemo(() => {
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth() + 1;
        return classifyYearMonth(y, m);
    }, [currentDate]);
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedObjective, setSelectedObjective] = useState('');
    const [forceShowAll, setForceShowAll] = useState(false);
    const [dotacionPoolReady, setDotacionPoolReady] = useState(false);
    const [showVolantes, setShowVolantes] = useState(false);
    const [nearbyKmRadius, setNearbyKmRadius] = useState(DOTACION_NEARBY_KM_DEFAULT);
    const [nearbyKmDraft, setNearbyKmDraft] = useState(String(DOTACION_NEARBY_KM_DEFAULT));
    const [dotacionPoolType, setDotacionPoolType] = useState<'RET' | 'F' | 'LIBRE' | null>('RET');
    const [dotacionPoolSearch, setDotacionPoolSearch] = useState('');
    const deferredDotacionPoolSearch = useDeferredValue(dotacionPoolSearch);
    const [isFilterPending, startFilterTransition] = useTransition();
    const [showAjustarCronoModal, setShowAjustarCronoModal] = useState(false);
    const [showEquilibrarModal, setShowEquilibrarModal] = useState(false);
    const [backgroundSaveCount, setBackgroundSaveCount] = useState(0);
    const [sortBy, setSortBy] = useState<'name' | 'activity' | 'client' | 'band' | 'position'>('activity');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [sortDropOpen, setSortDropOpen] = useState(false);
    const [bandDropOpen, setBandDropOpen] = useState(false);
    const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
    const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
    const [cronoFullscreen, setCronoFullscreen] = useState(false);
    const [statsBarCollapsed, setStatsBarCollapsed] = useState(false);
    const [statsHoursView, setStatsHoursView] = useState<'total' | 'detalle'>('total');

    const {
        isDataSyncing,
        employees,
        slaIdToObjId,
        shiftsMap,
        setShiftsMap,
        cellTurnosMap,
        setCellTurnosMap,
        shiftsMapLoaded,
        turaMap,
        rfzVacantes,
        rfzTodos,
        allShiftIds,
        absencesMap,
        clients,
        agreements,
        unifiedLogs,
        notifLogs,
        latestLog,
        clearLatestLogNotification,
        notifications,
        setNotifications,
        hasUnread,
        setHasUnread,
        secondBlockMap,
    } = usePlanificacionFirestore({
        empresaId,
        migracionCompleta,
        scopeEmpresa,
        currentDate,
    });
    const tenantClientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);
    const [rfzAsignando, setRfzAsignando] = useState<any>(null);          // RFZ vacante abierto para asignación
    const [activityTab, setActivityTab] = useState<'cambios' | 'notifs'>('cambios');
    const [showActivityModal, setShowActivityModal] = useState(false);
    const [customOrderMap, setCustomOrderMap] = useState<Record<string, string[]>>(() => {
        if (typeof window === 'undefined') return {};
        try { return JSON.parse(localStorage.getItem('planif_emp_order') || '{}'); } catch { return {}; }
    });
    const [dragOverVisual, setDragOverVisual] = useState<number | null>(null);
    const [shiftTooltip, setShiftTooltip] = useState<{ label: string | null; pos: string | null; range: string | null; x: number; y: number; restHours?: number | null } | null>(null);
    const [coverageTooltip, setCoverageTooltip] = useState<{
        dateStr: string;
        gaps: { positionName: string; code: string; gapBand?: string; missing: number; detail?: string }[];
        x: number;
        y: number;
    } | null>(null);
    const [slaGapCloseModal, setSlaGapCloseModal] = useState<SlaGapCloseModalData | null>(null);
    const [shiftExtendModal, setShiftExtendModal] = useState<ShiftExtendModalData | null>(null);
    const [showCoverageDiagnostic, setShowCoverageDiagnostic] = useState(false);
    const [columnSelectMode, setColumnSelectMode] = useState(false);
    const [columnSelectSource, setColumnSelectSource] = useState<number | null>(null);
    const [openDrop, setOpenDrop] = useState<'client' | 'objective' | 'grupo' | null>(null);
    const [selectedGrupo, setSelectedGrupo] = useState<GrupoObjetivos | null>(null);
    const [planViewReady, setPlanViewReady] = useState(false);
    useEffect(() => {
        const saved = readSessionJson<{
            client?: string;
            objective?: string;
            y?: number;
            m?: number;
        }>('cosp:plan:view');
        if (saved) {
            if (saved.client) setSelectedClient(saved.client);
            if (saved.objective) setSelectedObjective(saved.objective);
            if (typeof saved.y === 'number' && typeof saved.m === 'number') {
                setCurrentDate(new Date(saved.y, saved.m, 1));
            }
        }
        setPlanViewReady(true);
    }, []);
    useEffect(() => {
        if (!planViewReady) return;
        writeSessionJson('cosp:plan:view', {
            client: selectedClient,
            objective: selectedObjective,
            y: currentDate.getFullYear(),
            m: currentDate.getMonth(),
        });
    }, [planViewReady, selectedClient, selectedObjective, currentDate]);
    /** Deep-link desde Análisis: ?objectiveId=&clientId=&year=&month= (mes 1–12) */
    const deepLinkAppliedRef = useRef(false);
    useEffect(() => {
        if (!planViewReady || !clients.length || deepLinkAppliedRef.current || !router.isReady) return;
        const oid = String(router.query.objectiveId ?? '').trim();
        if (!oid) return;
        deepLinkAppliedRef.current = true;
        let clientId = String(router.query.clientId ?? '').trim();
        if (!clientId) {
            for (const c of clients) {
                const objs = (c.objetivos || []) as any[];
                if (objs.some((o) => String(o.id || o.name || '').trim() === oid)) {
                    clientId = c.id;
                    break;
                }
            }
        }
        if (clientId) setSelectedClient(clientId);
        setSelectedObjective(oid);
        setSelectedGrupo(null);
        const y = Number(router.query.year);
        const m = Number(router.query.month);
        if (Number.isFinite(y) && y > 2000 && Number.isFinite(m) && m >= 1 && m <= 12) {
            goToPlanningMonth(y, m - 1);
        }
        void router.replace('/admin/planificacion/', undefined, { shallow: true });
    }, [planViewReady, clients, router.isReady, router.query.objectiveId, router.query.clientId, router.query.year, router.query.month, goToPlanningMonth]);
    const [grupos, setGrupos] = useState<GrupoObjetivos[]>([]);
    const [showGrupoForm, setShowGrupoForm] = useState(false);
    const [grupoFormMode, setGrupoFormMode] = useState<'new' | 'edit'>('new');
    const [grupoFormNombre, setGrupoFormNombre] = useState('');
    const [grupoFormClientId, setGrupoFormClientId] = useState('');
    const [grupoFormObjectiveIds, setGrupoFormObjectiveIds] = useState<string[]>([]);
    const [grupoFormEditId, setGrupoFormEditId] = useState<string | null>(null);
    const [savingGrupo, setSavingGrupo] = useState(false);
    const [grupoUnifiedMode, setGrupoUnifiedMode] = useState(true);
    const {
        grupoSlaMap,
        grupoTotalVendidas,
        grupoVendidasByObjective,
    } = usePlanificacionGrupoSla({
        selectedGrupo,
        grupoUnifiedMode,
        selectedClient,
        currentDate,
        empresaId,
        scopeEmpresa,
        clients,
        tenantClientIds,
        slaIdToObjId,
    });
    const grupoObjColorMap = useMemo<Map<string, string>>(() => {
        if (!selectedGrupo) return new Map();
        return new Map(selectedGrupo.objectiveIds.map((id, i) => [id, GRUPO_COLOR_HEX[i % GRUPO_COLOR_HEX.length]]));
    }, [selectedGrupo]);
    const planningObjectiveIdForModals = selectedObjective || selectedGrupo?.objectiveIds?.[0] || '';
    const longPressTimer = useRef<any>(null);
    const [empDefaultPos, setEmpDefaultPos] = useState<Record<string, string>>({});
    const [empDefaultShift, setEmpDefaultShift] = useState<Record<string, string>>({});
    const objectiveSortAppliedRef = useRef<string | null>(null);
    const [empPosPicker, setEmpPosPicker] = useState<{ empId: string; x: number; y: number; maxHeight: number; floating?: boolean } | null>(null);
    const [deployBandPicker, setDeployBandPicker] = useState<'SURPLUS' | 'TRAINING' | null>(null);
    /** Picker REF/ESC desde selección masiva (bandas = turnos reales del puesto). */
    const [bulkDeployPicker, setBulkDeployPicker] = useState<{
        intent: 'SURPLUS' | 'TRAINING';
        onlyEmpId?: string;
        positionName: string;
        bands: { code: string; name?: string; hours?: number; startTime?: string; endTime?: string }[];
    } | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifPanelTop, setNotifPanelTop] = useState(0);
    const notifBtnRef = useRef<HTMLButtonElement>(null);
    const diagnosticBtnRef = useRef<HTMLButtonElement>(null);
    const coverageDiagnosticBtnRef = useRef<HTMLButtonElement>(null);
    const [diagnosticPanelPos, setDiagnosticPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [coveragePanelPos, setCoveragePanelPos] = useState<{ x: number; y: number } | null>(null);
    
    const [operatorName, setOperatorName] = useState('Cargando...');
    const [operatorEmail, setOperatorEmail] = useState('');
    const [usersMap, setUsersMap] = useState<Record<string, string>>({}); 

    const [showDiagnostic, setShowDiagnostic] = useState<boolean>(false);
    const [publishStatusMap, setPublishStatusMap] = useState<Record<string, { publishedAt: any; publishedBy: string } | null>>({});
    const [needsRepublishMap, setNeedsRepublishMap] = useState<Record<string, boolean>>({});
    const [isPublishing, setIsPublishing] = useState(false);
    const [isUnpublishing, setIsUnpublishing] = useState(false);
    const [isRefreshingCrono, setIsRefreshingCrono] = useState(false);
    const [dataRefreshNonce, setDataRefreshNonce] = useState(0);
    const {
        positionStructure,
        activePlanningSlaRow,
        slaVendidas,
        hasActiveSLA,
        slaPlanningHint,
        activeSlaPositionAssignments,
        activeSlaServiceRules,
        activeSlaServiceRotations,
    } = usePlanificacionObjectiveSla({
        selectedClient,
        selectedObjective,
        currentDate,
        empresaId,
        migracionCompleta,
        scopeEmpresa,
        clients,
        tenantClientIds,
        slaIdToObjId,
        dataRefreshNonce,
    });
    const [publishConfirmModal, setPublishConfirmModal] = useState<PublishConfirmModalState | null>(null);
    const [publishConfirmPin, setPublishConfirmPin] = useState('');
    const [publishConfirmPinError, setPublishConfirmPinError] = useState('');
    const [publishConfirmPinChecking, setPublishConfirmPinChecking] = useState(false);
    const [correctionMode, setCorrectionMode] = useState(false);
    const [cellEditMode, setCellEditMode] = useState(false);
    // 🛑 SYNC-CORE: Estado activo inicial null para forzar limpieza
    const [activePosition, setActivePosition] = useState<string | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showGuardiaSearch, setShowGuardiaSearch] = useState(false);
    const [highlightEmpId, setHighlightEmpId] = useState<string | null>(null);
    const [pinnedExternalEmpIds, setPinnedExternalEmpIds] = useState<Set<string>>(new Set());
    const [cellTargetObjectiveId, setCellTargetObjectiveId] = useState<string | null>(null);
    /** Objetivo destino al asignar en masa a colaboradores EXT (grupo unificado). */
    const [bulkTargetObjectiveId, setBulkTargetObjectiveId] = useState<string | null>(null);
    /** Objetivo por EXT cuando hay varios en la misma selección (empId → objectiveId). */
    const [bulkEmpObjectiveOverrides, setBulkEmpObjectiveOverrides] = useState<Record<string, string>>({});
    /** Puesto elegido en la barra masiva mono-objetivo (paso previo al turno). */
    const [bulkBarPosition, setBulkBarPosition] = useState<string | null>(null);
    /** Filtro de puesto por guardia en panel bulk (solo paleta de turnos; no persiste asignación). */
    const [bulkEmpPositionFilter, setBulkEmpPositionFilter] = useState<Record<string, string>>({});
    const [bandFilter, setBandFilter] = useState<string | null>(null);
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm);
    const deferredAddSearchTerm = useDeferredValue(addSearchTerm);
    const [selectedCell, setSelectedCell] = useState<any>(null);

    const [authModal, setAuthModal] = useState<{
        pendingFn: (() => Promise<void>) | null;
        employees: { name: string; hours: number; detail?: string }[];
        operatorName?: string;
        isSaveFlow?: boolean;
        description?: React.ReactNode;
        auditAction?: string;
        auditDetails?: string;
    }>({ pendingFn: null, employees: [] });
    const [authPin, setAuthPin] = useState('');
    const [authError, setAuthError] = useState('');
    const [authLoading, setAuthLoading] = useState(false);

    const [pendingAssignment, setPendingAssignment] = useState<any>(null); 
    const [authWarningMessage, setAuthWarningMessage] = useState('');

    const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
    const [pendingNovedades, setPendingNovedades] = useState<Record<string, any>>({});
    const [selection, setSelection] = useState<{start: Coords | null, end: Coords | null}>({ start: null, end: null });
    const [isDragging, setIsDragging] = useState(false);

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyVersions, setHistoryVersions] = useState<any[]>([]);
    const [comparingSnapshot, setComparingSnapshot] = useState<any | null>(null);
    const [compareShowOnlyDiffs, setCompareShowOnlyDiffs] = useState(false);
    const [compareLayout, setCompareLayout] = useState<'side' | 'stack'>('side');
    const [showCompareDiffModal, setShowCompareDiffModal] = useState(false);
    const [showCompareSummaryModal, setShowCompareSummaryModal] = useState(false);

    const [francoMode, setFrancoMode] = useState<'NONE' | 'FT_SELECTION' | 'FF_WIZARD'>('NONE');
    const [showSwapModal, setShowSwapModal] = useState(false);
    const [swapConfig, setSwapConfig] = useState<any>(null);
    const [selectedSwapTarget, setSelectedSwapTarget] = useState('');
    const [selectedSwapDate, setSelectedSwapDate] = useState('');
    const [swapSearchTerm, setSwapSearchTerm] = useState(''); 
    const [targetFrancos, setTargetFrancos] = useState<any[]>([]);
    const [coverageStep, setCoverageStep] = useState(false);
    const [coverShift1, setCoverShift1] = useState('M');
    const [coverShift2, setCoverShift2] = useState('M');
    const [isShift1Fixed, setIsShift1Fixed] = useState(false);
    const [isShift2Fixed, setIsShift2Fixed] = useState(false);

    const [showRRHHModal, setShowRRHHModal] = useState(false);
    const [rrhhData, setRrhhData] = useState({ type: 'Injustificada', reason: '' });
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [conflictNeighbors, setConflictNeighbors] = useState<{prev: any, next: any} | null>(null);

    // --- EVENTOS ---
    const [eventos, setEventos] = useState<Evento[]>([]);
    const [showEventoCreateModal, setShowEventoCreateModal] = useState(false);
    const [eventoForm, setEventoForm] = useState<Partial<Evento>>({ status: 'activo', horaInicio: '08:00', horaFin: '20:00', cupoGuardias: 5 });
    const [eventoFormSaving, setEventoFormSaving] = useState(false);
    /** Key del crono-cell (empId_dateStr) que muestra el sub-picker de evento */
    const [eventoPickerKey, setEventoPickerKey] = useState<string | null>(null);

    // Clipboard para copy/paste/cut de celdas + deshacer (Ctrl+Z) sobre pendingChanges
    const [clipboard, setClipboard] = useState<Array<{relRow: number; relCol: number; shift: any | null}> | null>(null);
    const [clipboardDim, setClipboardDim] = useState<{rows: number; cols: number} | null>(null);
    const [clipboardIsCut, setClipboardIsCut] = useState(false);
    const undoStackRef = useRef<Record<string, any>[]>([]);
    const pendingChangesRef = useRef(pendingChanges);
    pendingChangesRef.current = pendingChanges;

    /** Guarda snapshot antes de mutar pendingChanges (máx. 40 pasos). */
    const commitPendingChanges = useCallback((
        next: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>),
    ) => {
        setPendingChanges(prev => {
            undoStackRef.current = [...undoStackRef.current.slice(-39), { ...prev }];
            return typeof next === 'function' ? next(prev) : next;
        });
    }, []);

    const undoLastPending = useCallback(() => {
        const stack = undoStackRef.current;
        if (stack.length === 0) {
            toast.info('Nada para deshacer');
            return;
        }
        const prev = stack[stack.length - 1];
        undoStackRef.current = stack.slice(0, -1);
        setPendingChanges(prev);
        toast.success('Deshecho (Ctrl+Z)');
    }, []);

    const clearUndoStack = useCallback(() => {
        undoStackRef.current = [];
    }, []);

    const [prevMonthLoading, setPrevMonthLoading] = useState(false);
    const [autoGeneratedReady, setAutoGeneratedReady] = useState(false);
    const [autoCycles, setAutoCycles] = useState<string[]>([]);
    const autoSelectedCyclesRef = useRef<string[]>([]);
    const [mesRotacionesDesactivadas, setMesRotacionesDesactivadas] = useState<Set<string>>(new Set());
    const [rotMesDropOpen, setRotMesDropOpen] = useState(false);

    const { activateRfzCorrectionFlow } = usePlanificacionPublishState({
        selectedObjective,
        currentDate,
        empresaId,
        dataRefreshNonce,
        publishStatusMap,
        setPublishStatusMap,
        setMesRotacionesDesactivadas,
        rfzTodos,
        canCorrectPlanning,
        setNeedsRepublishMap,
        setCorrectionMode,
    });

    const { resetAutoRotAppliedGuard } = usePlanificacionAutoRotation({
        shiftsMapLoaded,
        activeSlaServiceRotations,
        selectedObjective,
        hasActiveSLA,
        currentDate,
        shiftsMap,
        selectedGrupo,
        grupoUnifiedMode,
        mesRotacionesDesactivadas,
        positionStructure,
        activeSlaServiceRules,
        employees,
        commitPendingChanges,
    });

    const _saveRotOverrides = useCallback((next: Set<string>, objId: string, yr: number, mo: number, empId: string) => {
        const stateKey = buildPlanificacionEstadoDocId(empId, objId, yr, mo);
        setDoc(doc(db, 'planificacion_estados', stateKey),
            { rotacionesDesactivadasMes: Array.from(next), empresaId: empId },
            { merge: true },
        ).catch(e => console.warn('[planif] rot-overrides save', e));
    }, []);

    const toggleMesRotacion = useCallback((rotId: string) => {
        if (!selectedObjective) return;
        const yr = currentDate.getFullYear(), mo = currentDate.getMonth() + 1;
        setMesRotacionesDesactivadas(prev => {
            const next = new Set(prev);
            if (next.has(rotId)) next.delete(rotId); else next.add(rotId);
            _saveRotOverrides(next, selectedObjective, yr, mo, empresaId);
            return next;
        });
        resetAutoRotAppliedGuard();
    }, [selectedObjective, currentDate, empresaId, _saveRotOverrides, resetAutoRotAppliedGuard]);

    const toggleTodasMesRotaciones = useCallback((desactivar: boolean) => {
        if (!selectedObjective || !activeSlaServiceRotations?.length) return;
        const yr = currentDate.getFullYear(), mo = currentDate.getMonth() + 1;
        const next = desactivar
            ? new Set((activeSlaServiceRotations as any[]).map(r => r.id as string))
            : new Set<string>();
        setMesRotacionesDesactivadas(next);
        _saveRotOverrides(next, selectedObjective, yr, mo, empresaId);
        resetAutoRotAppliedGuard();
    }, [selectedObjective, currentDate, empresaId, activeSlaServiceRotations, _saveRotOverrides, resetAutoRotAppliedGuard]);
    const [autoOverwrite, setAutoOverwrite] = useState(false);
    const [useSixPlusOne, setUseSixPlusOne] = useState(false);
    /** true = forzar siempre 6+2 (default). false = dejar que el cerebro elija entre 6+2/6+1/4+2. */
    /** Tópico activo en el panel de ayuda del modal AUTO (hover sobre opciones). */
    const [autoHelpTopic, setAutoHelpTopic] = useState<string>('default');
    /** false = banda fija (M/T/N todo el mes). true = rotación por bloque 6+2/4+2 (MMMMMMFF→siguiente banda). */
    /** null = Auto decide; true/false = forzar rotativo ON/OFF */
    const [autoRotateForce, setAutoRotateForce] = useState<boolean | null>(null);
    const [autoAjustarCrono, setAutoAjustarCrono] = useState(false);
    /** Fechas manuales Contingencia (Modo 12 para liberar guardias / RET). */
    const [autoContingenciaDias, setAutoContingenciaDias] = useState<Set<string>>(() => new Set());
    const [autoPlanningBrainReport, setAutoPlanningBrainReport] = useState<AutoPlanningBrainResult | null>(null);
    const autoPlanningBrainRef = React.useRef<AutoPlanningBrainResult | null>(null);
    const autoPlanningBrainInputRef = React.useRef<Parameters<typeof resolveAutoPlanningBrain>[0] | null>(null);

    useEffect(() => {
        if (autoRotateForce === false && autoAjustarCrono) setAutoAjustarCrono(false);
    }, [autoRotateForce, autoAjustarCrono]);

    // ── Automatización COSP (viabilidad + motor determinístico) ──
    const [showAutoV2Modal, setShowAutoV2Modal] = useState(false);
    const [autoV2Loading, setAutoV2Loading] = useState(false);
    const [autoV2Generating, setAutoV2Generating] = useState(false);
    /** Barra de progreso en el modal de automatización (viabilidad / generar). */
    const [autoV2Progress, setAutoV2Progress] = useState<{ pct: number; label: string } | null>(null);
    const [autoV2Report, setAutoV2Report] = useState<import('@/lib/planificacion/autoScheduleEngineV2').V2FeasibilityReport | null>(null);
    const autoV2ReportRef = React.useRef<import('@/lib/planificacion/autoScheduleEngineV2').V2FeasibilityReport | null>(null);
    const [autoV2CoveragePreflight, setAutoV2CoveragePreflight] = useState<ObjectiveCoveragePreflight | null>(null);
    const [autoAbsencesMap, setAutoAbsencesMap] = useState<Record<string, Map<string, string>>>({});
    const [autoV2BudgetMode, setAutoV2BudgetMode] = useState<'cct'|'calendar'>('cct');
    const [autoV2ShowEmpDetail, setAutoV2ShowEmpDetail] = useState(false);
    // Stats post-generación (capacidad CCT por empleado)
    const [autoV2GenStats, setAutoV2GenStats] = useState<{
        employeeMonthlyHours: Record<string, number>;
        employeeCycleHours: { current: Record<string, number>; next: Record<string, number> };
        targetHours: number;
        totalBillableHours: number;
        /** Horas que realmente ve la grilla (pending + celdas no sobreescritas). */
        gridBillableHours?: number;
        cellsSkippedOverwrite?: number;
        uncoveredSlots: number;
        idleEmployeeIds?: string[];
        strandedEmployeeIds?: string[];
        relocatedEmployeeIds?: string[];
        primaryShiftByEmp?: Record<string, string | null>;
        positionGroups?: Record<string, string[]>;
        employeeRetCount?: Record<string, number>;
        employeeRetHoursPotential?: Record<string, number>;
        totalRetCount?: number;
        totalRetHoursPotential?: number;
        overCoverageRetDays?: number;
        maxRetConcurrent?: number;
        ajustarCrono?: boolean;
        apretarCronoDays?: string[];
        uncoveredSlotsByDay?: Record<string, { positionName: string; code: string; missing: number }[]>;
        excessPositionEmployees?: { positionName: string; assigned: number; needed: number; excess: number }[];
        slaDeficitRemaining?: number;
        slaHoursClosed?: boolean;
    } | null>(null);
    const [showCapacityModal, setShowCapacityModal] = useState(false);
    const [showHoursBreakdownModal, setShowHoursBreakdownModal] = useState(false);
    // Reporte de verificación de cobertura post-generación (V2)
    const [autoV2Coverage, setAutoV2Coverage] = useState<import('@/lib/planificacion/coverageVerification').CoverageVerificationReport | null>(null);
    const [autoV2FormReport, setAutoV2FormReport] = useState<import('@/lib/planificacion/scheduleFormValidator').ScheduleFormValidationReport | null>(null);
    const [autoV2RebalanceLog, setAutoV2RebalanceLog] = useState<FormRebalanceLogEntry[]>([]);
    const [autoV2Rebalancing, setAutoV2Rebalancing] = useState(false);
    const [autoV2Suggestions, setAutoV2Suggestions] = useState<import('@/lib/planificacion/scheduleOptimizationSuggestions').ScheduleChangeSuggestion[] | null>(null);
    const [showCoverageModal, setShowCoverageModal] = useState(false);
    // Snapshot de la última generación para reprocesar errores sin volver a llamar al motor
    const [autoV2LastRun, setAutoV2LastRun] = useState<{
        assignments: import('@/lib/planificacion/autoScheduleEngineV2').V2Assignment[];
        stats: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateStats;
        ctx: import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext;
    } | null>(null);
    const [autoV2Fixing, setAutoV2Fixing] = useState(false);
    const [autoV2RunGemini, setAutoV2RunGemini] = useState(false);
    const [autoCoverAbsences, setAutoCoverAbsences] = useState(false);
    const [autoV2TrailDiag, setAutoV2TrailDiag] = useState<Array<{
        id: string; nombre: string; puesto: string; puestoQty: number;
        lastBand: string; trailWork: number; trailRest: number;
        julioSlot?: number; julioBand?: string; diasFranco?: number;
    }> | null>(null);
    const [autoV2ShowTrailDiag, setAutoV2ShowTrailDiag] = useState(false);
    const [autoCoverageGaps, setAutoCoverageGaps] = useState<import('@/lib/planificacion/coverageEngine').CoverageGap[]>([]);
    const [planCoverageModalGaps, setPlanCoverageModalGaps] = useState<(import('@/lib/planificacion/coverageEngine').CoverageGap & { absentName?: string })[]>([]);
    const [coverageSelectedDays, setCoverageSelectedDays] = useState<Set<string>>(new Set());
    const [autoV2GeminiLoading, setAutoV2GeminiLoading] = useState(false);
    const [autoV2GeminiSummary, setAutoV2GeminiSummary] = useState<string | null>(null);
    const [autoWizardStep, setAutoWizardStep] = useState<'configure'|'detecting'|'verified'|'sla_open'|'done'>('configure');
    // Empleados bloqueados por cap 200h en la última generación
    const [capOverflowEmps, setCapOverflowEmps] = useState<{ empId: string; nombre: string }[]>([]);
    // IDs autorizados por supervisor para superar 200h (ref = valor síncrono para el engine)
    const [authorizedOver200Ids, setAuthorizedOver200Ids] = useState<Set<string>>(new Set());
    const authorizedOver200IdsRef = React.useRef<Set<string>>(new Set());
    // Slots de apertura del último mes generado — permite continuar el ciclo al generar el mes siguiente sin publicar.
    const lastGenOpeningRef = React.useRef<{
        year: number; month: number; objectiveId: string;
        openingSlotByEmp: Record<string, number>; daysCount: number;
    } | null>(null);
    // UI de autorización 200h en el wizard
    const [over200AuthChecked, setOver200AuthChecked] = useState<Record<string, boolean>>({});
    const [over200AuthPin, setOver200AuthPin] = useState('');
    const [over200AuthError, setOver200AuthError] = useState('');
    const [autoWizardPersonalize, setAutoWizardPersonalize] = useState(false);
    const [slaDebug, setSlaDebug] = useState<{ id: string; data: any } | null>(null);
    const [slaDebugLoading, setSlaDebugLoading] = useState(false);
    const [hoursMode, setHoursMode] = useState<'mes' | 'cct'>('mes');
    const [nameColWidth, setNameColWidth] = useState(150);
    const nameColResizing = React.useRef<{ startX: number; startW: number } | null>(null);

    const [showVacancyModal, setShowVacancyModal] = useState(false);
    const [vacancyData, setVacancyData] = useState<any>(null);
    const [selectedReplacement, setSelectedReplacement] = useState('');
    const [vacancyActiveDates, setVacancyActiveDates] = useState<Set<string>>(new Set());
    const [vacancyDayCoverages, setVacancyDayCoverages] = useState<Record<string, VacancyDayCoverage>>({});
    const [vacancyEditingDay, setVacancyEditingDay] = useState<string | null>(null);
    const [vacancyReplacementSearch, setVacancyReplacementSearch] = useState('');
    const [vacancyReplacementOpen, setVacancyReplacementOpen] = useState(false);
    const [vacancyPickerTab, setVacancyPickerTab] = useState<'substitute' | 'split'>('substitute');
    const [vacancySplitExtId, setVacancySplitExtId] = useState('');
    const [vacancySplitAdelId, setVacancySplitAdelId] = useState('');
    const [vacancyApplyToAllSelected, setVacancyApplyToAllSelected] = useState(true);
    const [vacancyFrancoAuthApproved, setVacancyFrancoAuthApproved] = useState(false);
    const [vacancyGapBandOverride, setVacancyGapBandOverride] = useState<string | null>(null);
    const [vacancySplitExtExtraHours, setVacancySplitExtExtraHours] = useState<number | null>(null);
    const [vacancySplitSecondExtraHours, setVacancySplitSecondExtraHours] = useState<number | null>(null);
    const vacancyReplacementPanelRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!vacancyData?.startDate) {
            setVacancyActiveDates(new Set());
            setVacancyDayCoverages({});
            return;
        }
        const all = listDateRangeInclusive(vacancyData.startDate, vacancyData.endDate || vacancyData.startDate);
        const focus = vacancyData.focusDate as string | undefined;
        const initialDates = focus && all.includes(focus) ? [focus] : all;
        setVacancyActiveDates(new Set(initialDates.length ? initialDates : all));
        setVacancyDayCoverages({});
        const activeCount = (initialDates.length ? initialDates : all).length;
        setVacancyApplyToAllSelected(activeCount > 1);
        if (activeCount > 1) {
            setVacancyEditingDay(null);
            setVacancyReplacementOpen(true);
        } else {
            const onlyDay = initialDates[0] || all[0] || null;
            setVacancyEditingDay(onlyDay);
            setVacancyReplacementOpen(!!onlyDay);
        }
        setSelectedReplacement('');
        setVacancyPickerTab('substitute');
        setVacancySplitExtId('');
        setVacancySplitAdelId('');
        setVacancyFrancoAuthApproved(false);
        setVacancyGapBandOverride(null);
        setVacancySplitExtExtraHours(null);
        setVacancySplitSecondExtraHours(null);
    }, [vacancyData]);

    useEffect(() => {
        if (showVacancyModal) {
            setVacancyReplacementSearch('');
        }
    }, [showVacancyModal]);

    useEffect(() => {
        if (!vacancyReplacementOpen) return;
        const t = window.setTimeout(() => {
            vacancyReplacementPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50);
        return () => window.clearTimeout(t);
    }, [vacancyReplacementOpen]);
    
    const [modifiers, setModifiers] = useState({ plannedNovedad: '' });
    const [recompositionModalOpen, setRecompositionModalOpen] = useState(false);
    const [pendingRecompositionPackages, setPendingRecompositionPackages] = useState<RecompositionPackage[]>([]);
    const [showCronogramasOverview, setShowCronogramasOverview] = useState(false);

    const [showLegend, setShowLegend] = useState(false);
    const [selectedRef, setSelectedRef] = useState<string | null>(null);

    const setPageHeader = useSetPageHeader();
    useEffect(() => {
        setPageHeader({ compactSidebar: true });
        return () => setPageHeader({ compactSidebar: false });
    }, [setPageHeader]);

    const floatingInitialObjective = useMemo(() => {
        if (!selectedClient || !selectedObjective) return '';
        const objs = (clients.find((c) => c.id === selectedClient)?.objetivos || []) as any[];
        const other = objs.find((o) => (o.id || o.name) !== selectedObjective);
        return other ? (other.id || other.name) : selectedObjective;
    }, [clients, selectedClient, selectedObjective]);

    const repositionDiagnosticPanel = useCallback(() => {
        const rect = diagnosticBtnRef.current?.getBoundingClientRect();
        if (rect) setDiagnosticPanelPos({ x: rect.left, y: rect.bottom + 4 });
    }, []);

    const repositionCoveragePanel = useCallback(() => {
        const rect = coverageDiagnosticBtnRef.current?.getBoundingClientRect();
        if (rect) setCoveragePanelPos({ x: rect.left, y: rect.bottom + 4 });
    }, []);

    useEffect(() => {
        if (!showDiagnostic) return;
        repositionDiagnosticPanel();
        window.addEventListener('scroll', repositionDiagnosticPanel, true);
        window.addEventListener('resize', repositionDiagnosticPanel);
        return () => {
            window.removeEventListener('scroll', repositionDiagnosticPanel, true);
            window.removeEventListener('resize', repositionDiagnosticPanel);
        };
    }, [showDiagnostic, repositionDiagnosticPanel]);

    useEffect(() => {
        if (!showCoverageDiagnostic) return;
        repositionCoveragePanel();
        window.addEventListener('scroll', repositionCoveragePanel, true);
        window.addEventListener('resize', repositionCoveragePanel);
        return () => {
            window.removeEventListener('scroll', repositionCoveragePanel, true);
            window.removeEventListener('resize', repositionCoveragePanel);
        };
    }, [showCoverageDiagnostic, repositionCoveragePanel]);

    useEffect(() => {
        setToolbarCollapsed(localStorage.getItem('planif_toolbar_collapsed') === '1');
        setStatsBarCollapsed(localStorage.getItem('planif_stats_collapsed') === '1');
        const hv = localStorage.getItem('planif_stats_hours_view');
        if (hv === 'total' || hv === 'detalle') setStatsHoursView(hv);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (cronoFullscreen) setCronoFullscreen(false);
                if (toolbarMoreOpen) setToolbarMoreOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [cronoFullscreen, toolbarMoreOpen]);

    // Cargar eventos de la empresa para el mes visible
    useEffect(() => {
        if (!empresaId) return;
        const yr = currentDate.getFullYear();
        const mo = currentDate.getMonth() + 1;
        const fromDate = `${yr}-${String(mo).padStart(2, '0')}-01`;
        const lastDay = new Date(yr, mo, 0).getDate();
        const toDate = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        eventoService.getByEmpresaAndRange(empresaId, fromDate, toDate, true)
            .then(evs => setEventos(evs.filter(ev => ev.status !== 'cancelado' && ev.status !== 'ejecutado')))
            .catch(console.error);
    }, [empresaId, currentDate]);

    // ============================================================================
    // 2. UTILIDADES Y HELPERS (NIVEL 1 - Definidos ANTES de usarse)
    // ============================================================================

    const activeActorName = useMemo(() => {
        if (sessionAuthLoading) return 'Cargando...';
        if (!authUser) return 'Sin sesión';
        return usersMap[operatorEmail] || authUser.displayName || authUser.email || operatorName || 'Usuario';
    }, [sessionAuthLoading, authUser, usersMap, operatorEmail, operatorName]);

    const daysInMonth = useMemo(() => { 
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); 
        const days = []; 
        while (d.getMonth() === currentDate.getMonth()) { 
            days.push(new Date(d)); 
            d.setDate(d.getDate() + 1); 
        } 
        return days; 
    }, [currentDate]);

    const getObjectiveName = (objId: string) => {
        if (!objId) return 'Desconocido';
        for (const client of clients) {
            if (client.objetivos) {
                const found = client.objetivos.find((o: any) => (o.id || o.name) === objId);
                if (found) return found.name;
            }
        }
        return objId;
    };

    // 🛑 Helpers de dotación — stats precalculados evitan re-escaneos O(n×días) en cada filtro/orden
    const BAND_FILTERABLE = useMemo(() => new Set(['M', 'T', 'N', 'D12', 'N12', 'RET', 'REF', 'ESC']), []);

    const activeGuestIdsForObjective = useMemo(() => {
        if (!selectedObjective) return new Set<string>();
        const ids = new Set<string>();
        const planYear = currentDate.getFullYear();
        const planMonth = currentDate.getMonth(); // 0-indexed
        // En modo grupo unificado: aceptar cualquier objetivo del grupo; sino solo el objetivo activo
        const matchesObjective = (objId: string) =>
            (selectedGrupo && grupoUnifiedMode) ? selectedGrupo.objectiveIds.includes(objId) : objId === selectedObjective;
        for (const [key, shift] of Object.entries(shiftsMap) as [string, any][]) {
            if (matchesObjective(shift?.objectiveId) && shift?.employeeId) {
                const [sy, sm] = key.slice(-10).split('-').map(Number);
                if (sy === planYear && sm - 1 === planMonth) {
                    ids.add(shift.employeeId);
                }
            }
        }
        for (const [key, change] of Object.entries(pendingChanges) as [string, any][]) {
            if (matchesObjective(change?.objectiveId) && change?.employeeId && !change?.isDeleted) {
                const [cy, cm] = key.slice(-10).split('-').map(Number);
                if (cy === planYear && cm - 1 === planMonth) {
                    ids.add(change.employeeId);
                }
            }
        }
        return ids;
    }, [shiftsMap, pendingChanges, selectedObjective, selectedGrupo, grupoUnifiedMode, currentDate]);

    const selectedObjectiveData = useMemo(() => {
        if (!selectedObjective || !selectedClient) return null;
        const client = clients.find((c: any) => c.id === selectedClient);
        if (!client) return null;
        return client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) || null;
    }, [clients, selectedClient, selectedObjective]);

    useEffect(() => {
        const km = readStoredNearbyKm();
        setNearbyKmRadius(km);
        setNearbyKmDraft(String(km));
    }, []);

    const isEmployeeOnSelectedObjective = useCallback((e: { id: string; preferredObjectiveId?: string }) => {
        if (!selectedObjective) return false;
        if (
            e.preferredObjectiveId === selectedObjective ||
            slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
            activeGuestIdsForObjective.has(e.id)
        ) return true;
        // En modo grupo unificado: incluir empleados de cualquiera de los objetivos del grupo
        if (selectedGrupo && grupoUnifiedMode) {
            return selectedGrupo.objectiveIds.some(objId =>
                e.preferredObjectiveId === objId ||
                slaIdToObjId[e.preferredObjectiveId] === objId,
            );
        }
        return false;
    }, [selectedObjective, slaIdToObjId, activeGuestIdsForObjective, selectedGrupo, grupoUnifiedMode]);

    /** Dotación propia del objetivo (sin invitados ni cobertura de otro servicio). */
    const isEmployeeNativeToObjective = useCallback((e: { preferredObjectiveId?: string }) => {
        if (!selectedObjective || !e?.preferredObjectiveId) return false;
        return (
            e.preferredObjectiveId === selectedObjective ||
            slaIdToObjId[e.preferredObjectiveId] === selectedObjective
        );
    }, [selectedObjective, slaIdToObjId]);

    /** Objetivo nativo del empleado dentro del grupo (null = EXT / sin asignación en el grupo). */
    const resolveNativeObjectiveInGrupo = useCallback((e: { preferredObjectiveId?: string }): string | null => {
        if (!selectedGrupo || !e?.preferredObjectiveId) return null;
        if (selectedGrupo.objectiveIds.includes(e.preferredObjectiveId)) return e.preferredObjectiveId;
        const mapped = slaIdToObjId[e.preferredObjectiveId];
        if (mapped && selectedGrupo.objectiveIds.includes(mapped)) return mapped;
        return null;
    }, [selectedGrupo, slaIdToObjId]);

    /** Objetivo efectivo de un turno (explícito en shift/pending o nativo del legajo). */
    const resolveEffectiveShiftObjectiveId = useCallback((
        emp: { preferredObjectiveId?: string },
        shift: { objectiveId?: string } | null | undefined,
        pendingKey?: string,
    ): string | null => {
        const pending = pendingKey ? pendingChanges[pendingKey] : null;
        const explicit = pending?.objectiveId ?? shift?.objectiveId;
        if (explicit) {
            const rawId = String(explicit);
            // Turnos pueden guardar slaId; la cobertura de grupo compara contra objectiveId.
            return slaIdToObjId[rawId] || rawId;
        }
        return resolveNativeObjectiveInGrupo(emp);
    }, [pendingChanges, resolveNativeObjectiveInGrupo, slaIdToObjId]);

    const persistNearbyKm = useCallback((raw: number) => {
        const km = clampNearbyKm(raw);
        setNearbyKmRadius(km);
        setNearbyKmDraft(String(km));
        try { localStorage.setItem(NEARBY_KM_STORAGE_KEY, String(km)); } catch { /* ignore */ }
        return km;
    }, []);

    useEffect(() => {
        if (!forceShowAll) {
            setDotacionPoolReady(false);
            return;
        }
        const id = window.requestAnimationFrame(() => setDotacionPoolReady(true));
        return () => window.cancelAnimationFrame(id);
    }, [forceShowAll]);

    const slaEncargadoEmployeeId = String(activePlanningSlaRow?.encargadoEmployeeId || '').trim();

    const dotacionBaseEmployees = useMemo(() => {
        if (!selectedObjective) return [];
        let list = employees.filter(e => e.status !== 'inactivo');
        if (selectedGrupo && grupoUnifiedMode) {
            list = list.filter(e =>
                selectedGrupo.objectiveIds.some(objId =>
                    e.preferredObjectiveId === objId ||
                    slaIdToObjId[e.preferredObjectiveId] === objId,
                ) || activeGuestIdsForObjective.has(e.id) || pinnedExternalEmpIds.has(e.id)
                || (slaEncargadoEmployeeId && e.id === slaEncargadoEmployeeId)
                || !!(e.planificacionDotacion && selectedObjective && e.planificacionDotacion[selectedObjective]),
            );
        } else {
            list = list.filter(e =>
                e.preferredObjectiveId === selectedObjective ||
                slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
                activeGuestIdsForObjective.has(e.id) || pinnedExternalEmpIds.has(e.id) ||
                (showVolantes && (e.volante || []).includes(selectedObjective))
                || (slaEncargadoEmployeeId && e.id === slaEncargadoEmployeeId)
                || !!(e.planificacionDotacion && selectedObjective && e.planificacionDotacion[selectedObjective]),
            );
        }
        return list;
    }, [employees, selectedObjective, showVolantes, slaIdToObjId, activeGuestIdsForObjective, pinnedExternalEmpIds, selectedGrupo, grupoUnifiedMode, slaEncargadoEmployeeId]);

    const employeeMonthStats = useMemo(() => {
        const stats: Record<string, { shiftCount: number; dominantBand: string | null }> = {};
        for (const emp of dotacionBaseEmployees) {
            const counts: Record<string, number> = {};
            let shiftCount = 0;
            for (const day of daysInMonth) {
                const key = `${emp.id}_${getDateKey(day)}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const sh = pending && !pending.isDeleted ? pending : existing;
                if (!sh) continue;
                if (pending) {
                    if (!pending.isDeleted) shiftCount++;
                } else if (existing && existing.objectiveId === selectedObjective) {
                    shiftCount++;
                }
                const code = String(sh.code || sh.shiftCode || '').toUpperCase();
                if (BAND_FILTERABLE.has(code)) counts[code] = (counts[code] ?? 0) + 1;
            }
            stats[emp.id] = {
                shiftCount,
                dominantBand: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
            };
        }
        return stats;
    }, [dotacionBaseEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, BAND_FILTERABLE]);

    const empHasDotacionCode = (emp: any, code: string) => {
        const map = emp?.planificacionDotacion as PlanificacionDotacionMap | undefined;
        if (!map) return false;
        const needle = code.toUpperCase();
        return Object.values(map).some((cfg) => String(cfg?.shiftCode || '').toUpperCase() === needle);
    };

    const dotacionPoolCandidates = useMemo(() => {
        if (!forceShowAll || !dotacionPoolReady || !selectedObjective) return [] as Array<any & { _km: number | null; _kind: string }>;
        const gridIds = new Set(dotacionBaseEmployees.map((e: any) => e.id));
        const objLat = Number(selectedObjectiveData?.lat ?? 0);
        const objLng = Number(selectedObjectiveData?.lng ?? 0);
        const hasCoords = !!(objLat && objLng);
        const q = deferredDotacionPoolSearch.trim();
        const nearby: Array<{ emp: any; km: number | null }> = [];
        for (const e of employees) {
            if (e.status === 'inactivo' || gridIds.has(e.id)) continue;
            if (q && !matchesEmployeeSearch(e, q)) continue;
            const km = hasCoords ? employeeKmToObjective(e, objLat, objLng) : null;
            if (hasCoords && (km === null || km > nearbyKmRadius)) continue;
            nearby.push({ emp: e, km });
        }
        nearby.sort((a, b) => {
            const da = a.km ?? Infinity;
            const db = b.km ?? Infinity;
            if (da !== db) return da - db;
            return String(a.emp.name || '').localeCompare(String(b.emp.name || ''));
        });
        const scan = nearby.slice(0, DOTACION_NEARBY_SCAN_CAP);
        const dateKeys = daysInMonth.map((d: Date) => getDateKey(d));
        const out: Array<any & { _km: number | null; _kind: string }> = [];
        for (const { emp: e, km } of scan) {
            let shiftCount = 0;
            let hasRet = false;
            let hasFranco = false;
            for (const dateStr of dateKeys) {
                const key = `${e.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const sh = pending && !pending.isDeleted ? pending : shiftsMap[key];
                if (!sh || sh.isDeleted) continue;
                shiftCount += 1;
                const code = String(sh.code || sh.shiftCode || '').toUpperCase();
                if (code === 'RET') hasRet = true;
                if (code === 'F' || code === 'FF' || code === 'FP') hasFranco = true;
            }
            const isRet = hasRet || empHasDotacionCode(e, 'RET');
            const isFranco = hasFranco || empHasDotacionCode(e, 'F');
            const isLibre = shiftCount === 0;
            if (dotacionPoolType === 'RET' && !isRet) continue;
            if (dotacionPoolType === 'F' && !isFranco) continue;
            if (dotacionPoolType === 'LIBRE' && !isLibre) continue;
            const kind = isRet ? 'RET' : isFranco ? 'F' : isLibre ? 'Sin turno' : 'Turno';
            out.push({ ...e, _km: km, _kind: kind, _fromDotacionPool: true });
            if (out.length >= DOTACION_NEARBY_ROW_CAP) break;
        }
        return out;
    }, [forceShowAll, dotacionPoolReady, selectedObjective, selectedObjectiveData, employees, dotacionBaseEmployees, nearbyKmRadius, deferredDotacionPoolSearch, dotacionPoolType, daysInMonth, pendingChanges, shiftsMap]);

    const displayedEmployees = useMemo(() => {
        let list = dotacionBaseEmployees;
        if (bandFilter) {
            list = list.filter(e => employeeMonthStats[e.id]?.dominantBand === bandFilter);
        }
        const orderKey = selectedObjective || '__all__';
        const customOrder = customOrderMap[orderKey];
        let sorted: any[];
        if (customOrder && customOrder.length > 0) {
            const orderMap: Record<string, number> = {};
            customOrder.forEach((id: string, i: number) => { orderMap[id] = i; });
            sorted = [...list].sort((a: any, b: any) => {
                const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 9999;
                const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 9999;
                return ai - bi;
            });
        } else {
        const BAND_ORDER: Record<string, number> = { M: 0, T: 1, N: 2, D12: 3, N12: 4, RET: 5 };
        const dir = sortDir === 'asc' ? 1 : -1;
        sorted = [...list].sort((a, b) => {
            if (sortBy === 'activity') {
                const countA = employeeMonthStats[a.id]?.shiftCount ?? 0;
                const countB = employeeMonthStats[b.id]?.shiftCount ?? 0;
                if (countA !== countB) return (countB - countA) * dir;
            }
            if (sortBy === 'client') {
                const clientA = getObjectiveName(a.preferredObjectiveId);
                const clientB = getObjectiveName(b.preferredObjectiveId);
                const cmp = clientA.localeCompare(clientB);
                if (cmp !== 0) return cmp * dir;
            }
            if (sortBy === 'band') {
                const bandA = employeeMonthStats[a.id]?.dominantBand;
                const bandB = employeeMonthStats[b.id]?.dominantBand;
                const oa = bandA ? (BAND_ORDER[bandA] ?? 99) : 99;
                const ob = bandB ? (BAND_ORDER[bandB] ?? 99) : 99;
                if (oa !== ob) return (oa - ob) * dir;
            }
            if (sortBy === 'position') {
                const posA = empDefaultPos[`${a.id}___${selectedObjective}`] ?? '';
                const posB = empDefaultPos[`${b.id}___${selectedObjective}`] ?? '';
                if (!posA && posB) return 1;
                if (posA && !posB) return -1;
                const cmp = posA.localeCompare(posB);
                if (cmp !== 0) return cmp * dir;
            }
            return a.name.localeCompare(b.name) * dir;
        });
        }
        if (!forceShowAll || dotacionPoolCandidates.length === 0) return sorted;
        const ids = new Set(sorted.map((e: any) => e.id));
        return [...sorted, ...dotacionPoolCandidates.filter((e: any) => !ids.has(e.id))];
    }, [dotacionBaseEmployees, bandFilter, employeeMonthStats, sortBy, sortDir, selectedObjective, customOrderMap, empDefaultPos, clients, forceShowAll, dotacionPoolCandidates]);

    /** Guardias activos en dotación (excluye REF/ESC asignados como rol — no entran al auto ni al conteo). */
    const planningDotacionEmployees = useMemo(
        () => displayedEmployees.filter((e: any) => !e._fromDotacionPool && !isEmpExcludedFromPlanningDotacion(e, selectedObjective)),
        [displayedEmployees, selectedObjective],
    );

    /** Metadatos de la selección múltiple en grupo unificado (nativos vs EXT). */
    const bulkSelectionMeta = useMemo(() => {
        if (!selection.start || !selection.end) return { hasExt: false, hasNative: false, empCount: 0 };
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        let hasExt = false;
        let hasNative = false;
        const seen = new Set<string>();
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp || seen.has(emp.id)) continue;
            seen.add(emp.id);
            if (selectedGrupo && grupoUnifiedMode) {
                if (resolveNativeObjectiveInGrupo(emp)) hasNative = true;
                else hasExt = true;
            }
        }
        return { hasExt, hasNative, empCount: seen.size };
    }, [selection, displayedEmployees, selectedGrupo, grupoUnifiedMode, resolveNativeObjectiveInGrupo]);

    /** Colaboradores únicos en la selección múltiple actual. */
    const bulkSelectionEmployees = useMemo(() => {
        if (!selection.start || !selection.end) return [] as any[];
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const seen = new Set<string>();
        const list: any[] = [];
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp || seen.has(emp.id)) continue;
            seen.add(emp.id);
            list.push(emp);
        }
        return list;
    }, [selection, displayedEmployees]);

    /** Grupo unificado: panel integrado por colaborador en la barra de asignación. */
    const bulkPerEmpMode = useMemo(() => (
        !!(selectedGrupo && grupoUnifiedMode && bulkSelectionEmployees.length >= 1
            && (bulkSelectionEmployees.length >= 2 || bulkSelectionMeta.hasExt))
    ), [selectedGrupo, grupoUnifiedMode, bulkSelectionEmployees, bulkSelectionMeta.hasExt]);

    /**
     * Objetivo único de la selección actual.
     * En grupo: si todos los seleccionados son del mismo objetivo nativo (o EXT con el mismo destino),
     * la barra mono usa solo ese SLA (no mezcla M de Ville con M2 de María).
     */
    const bulkBarScopeObjectiveId = useMemo((): string | null => {
        if (!bulkSelectionEmployees.length) return selectedObjective || null;
        if (!(selectedGrupo && grupoUnifiedMode)) return selectedObjective || null;
        const objIds = new Set<string>();
        for (const emp of bulkSelectionEmployees) {
            const native = resolveNativeObjectiveInGrupo(emp);
            if (native) {
                objIds.add(native);
                continue;
            }
            const extObj = bulkEmpObjectiveOverrides[emp.id] || bulkTargetObjectiveId;
            if (!extObj) return null;
            objIds.add(extObj);
        }
        return objIds.size === 1 ? [...objIds][0]! : null;
    }, [
        bulkSelectionEmployees, selectedGrupo, grupoUnifiedMode, selectedObjective,
        resolveNativeObjectiveInGrupo, bulkEmpObjectiveOverrides, bulkTargetObjectiveId,
    ]);

    /** Turnos únicos del SLA de un objetivo (incluye códigos custom como M2). */
    const getShiftsForObjective = useCallback((objId: string) => {
        const structure = (selectedGrupo && grupoUnifiedMode && grupoSlaMap[objId]?.length)
            ? grupoSlaMap[objId]
            : positionStructure;
        const byCode = new Map<string, any>();
        for (const pos of (structure || [])) {
            for (const s of ((pos.shifts || []) as any[])) {
                const ck = String(s.code || '').toUpperCase();
                if (!ck || byCode.has(ck)) continue;
                byCode.set(ck, {
                    code: s.code,
                    name: s.name,
                    hours: s.hours,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    positionName: pos.positionName,
                });
            }
        }
        return [...byCode.values()];
    }, [selectedGrupo, grupoUnifiedMode, grupoSlaMap, positionStructure]);

    /** Turnos del SLA de un puesto concreto (mono-objetivo / barra por colaborador). */
    const getShiftsForPosition = useCallback((posName: string, objId?: string | null) => {
        const scopeObj = objId || selectedObjective;
        const structure = (selectedGrupo && grupoUnifiedMode && scopeObj && grupoSlaMap[scopeObj]?.length)
            ? grupoSlaMap[scopeObj]
            : positionStructure;
        const pos = (structure || []).find((p: any) => p.positionName === posName);
        if (!pos?.shifts?.length) return [];
        return (pos.shifts as any[]).map((s: any) => ({
            code: s.code,
            name: s.name,
            hours: s.hours,
            startTime: s.startTime,
            endTime: s.endTime,
            positionName: pos.positionName,
        }));
    }, [selectedGrupo, grupoUnifiedMode, grupoSlaMap, positionStructure, selectedObjective]);

    const resolveBulkEmpPosition = useCallback((emp: { id: string }, scopeObj?: string | null) => {
        const obj = scopeObj || selectedObjective;
        if (!obj) return null;
        return empDefaultPos[`${emp.id}___${obj}`] || null;
    }, [empDefaultPos, selectedObjective]);

    /** Puesto del guardia para panel bulk: default SLA o inferido de turnos en la selección. */
    const resolveBulkPanelEmpPosition = useCallback((emp: { id: string }, scopeObj?: string | null) => {
        const obj = scopeObj || bulkBarScopeObjectiveId || selectedObjective;
        if (!obj) return null;
        const fromDefault = empDefaultPos[`${emp.id}___${obj}`]
            || (selectedObjective ? empDefaultPos[`${emp.id}___${selectedObjective}`] : null);
        if (fromDefault) return fromDefault;
        if (!selection.start || !selection.end) return null;
        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);
        const inferred = new Set<string>();
        for (let c = minC; c <= maxC; c++) {
            const day = daysInMonth[c];
            if (!day) continue;
            const dateStr = getDateKey(day);
            const key = `${emp.id}_${dateStr}`;
            const pending = pendingChanges[key];
            const shift = pending ? (pending.isDeleted ? null : pending) : shiftsMap[key];
            const cellPos = shift?.positionName && !['General', 'Retén', ''].includes(String(shift.positionName))
                ? String(shift.positionName)
                : null;
            if (cellPos) inferred.add(cellPos);
        }
        return inferred.size === 1 ? [...inferred][0]! : null;
    }, [
        empDefaultPos, selectedObjective, bulkBarScopeObjectiveId,
        selection.start, selection.end, daysInMonth, pendingChanges, shiftsMap,
    ]);

    useEffect(() => {
        if (!selection.start) {
            setBulkEmpObjectiveOverrides({});
            setBulkBarPosition(null);
            setBulkEmpPositionFilter({});
        }
    }, [selection.start]);

    // Bell de planificación = novedades + vacantes RFZ derivadas de turnos (scope confiable, independiente del pipeline de novedades).
    const bellNotifications = useMemo(() => {
        const novedadSolIds = new Set(
            (notifications || [])
                .map((n: any) => n.solicitudRefuerzoId)
                .filter(Boolean)
                .map((x: any) => String(x)),
        );
        const sinteticas = (rfzVacantes || [])
            .filter((rfz: any) => !rfz.solicitudRefuerzoId || !novedadSolIds.has(String(rfz.solicitudRefuerzoId)))
            .map((rfz: any) => {
                const s = formatTime(rfz.startTime);
                const e = formatTime(rfz.endTime);
                return {
                    id: `rfzvac_${rfz.id}`,
                    source: 'NOVEDAD',
                    type: 'REFUERZO_CLIENTE_PENDIENTE',
                    tipoSolicitud: 'RFZ',
                    title: `RFZ · ${rfz.positionName || 'Refuerzo'} · ${rfz.objectiveName || ''}`.trim(),
                    msg: `Vacante de refuerzo sin asignar (${s}–${e}) del ${rfz.fecha}. Tocá para asignar guardia.`,
                    objectiveId: rfz.objectiveId,
                    objectiveName: rfz.objectiveName,
                    clientId: rfz.clientId,
                    clientName: rfz.clientName,
                    fecha: rfz.fecha,
                    startTime: rfz.startTime,
                    endTime: rfz.endTime,
                    solicitudRefuerzoId: rfz.solicitudRefuerzoId,
                    createdAt: rfz.autorizadoAt || rfz.createdAt,
                    __rfz: rfz,
                };
            });
        return [...notifications, ...sinteticas];
    }, [notifications, rfzVacantes]);

    const rfzDraftPendientesMes = useMemo(() => {
        if (!selectedObjective) return [];
        const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        return rfzTodos.filter(rfz =>
            rfz.objectiveId === selectedObjective &&
            String(rfz.fecha || '').startsWith(monthPrefix) &&
            rfz.draft === true,
        );
    }, [selectedObjective, currentDate, rfzTodos]);

    /** RFZ asignados indexados por empleado+fecha para mostrar en la fila del guardia. */
    const rfzByEmpDate = useMemo(() => {
        const m: Record<string, any> = {};
        if (!selectedObjective) return m;
        const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        for (const rfz of rfzTodos) {
            if (rfz.objectiveId !== selectedObjective) continue;
            if (!String(rfz.fecha || '').startsWith(monthPrefix)) continue;
            if (!rfz.employeeId || rfz.employeeId === 'VACANTE') continue;
            m[`${rfz.employeeId}_${rfz.fecha}`] = rfz;
        }
        return m;
    }, [rfzTodos, selectedObjective, currentDate]);

    const addModalEmployeeCandidates = useMemo(() => {
        const q = deferredAddSearchTerm.trim();
        const searching = q.length >= 1;
        const objLat = Number(selectedObjectiveData?.lat ?? 0);
        const objLng = Number(selectedObjectiveData?.lng ?? 0);
        const hasCoords = !!(objLat && objLng);
        let list = employees.filter((e: any) => e.status !== 'inactivo');
        if (searching) {
            list = list.filter((e: any) => matchesEmployeeSearch(e, q));
        } else {
            list = list.filter((e: any) => {
                if (isEmployeeOnSelectedObjective(e)) return true;
                if (!hasCoords) return false;
                const km = employeeKmToObjective(e, objLat, objLng);
                return km !== null && km <= nearbyKmRadius;
            });
        }
        const ranked = [...list].sort((a: any, b: any) => {
            const aAssigned = isEmployeeOnSelectedObjective(a);
            const bAssigned = isEmployeeOnSelectedObjective(b);
            if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
            if (hasCoords) {
                const da = employeeKmToObjective(a, objLat, objLng) ?? Infinity;
                const db = employeeKmToObjective(b, objLat, objLng) ?? Infinity;
                if (da !== db) return da - db;
            }
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        return ranked.slice(0, ASSIGN_SEARCH_LIMIT);
    }, [employees, deferredAddSearchTerm, selectedObjective, selectedObjectiveData, nearbyKmRadius, isEmployeeOnSelectedObjective]);

    const addModalMatchCount = useMemo(() => {
        const q = deferredAddSearchTerm.trim();
        if (q.length < 1) return addModalEmployeeCandidates.length;
        return employees.filter((e: any) => e.status !== 'inactivo' && matchesEmployeeSearch(e, q)).length;
    }, [employees, deferredAddSearchTerm, addModalEmployeeCandidates.length]);

    const guardiaSearchMatches = useMemo(() => {
        const q = deferredSearchTerm.trim();
        if (q.length < 2) return { inGrid: [] as any[], external: [] as any[] };
        const gridIds = new Set(displayedEmployees.map((e: any) => e.id));
        const inGrid: any[] = [];
        const external: any[] = [];
        for (const e of employees) {
            if (e.status === 'inactivo') continue;
            if (!matchesEmployeeSearch(e, q)) continue;
            if (gridIds.has(e.id) || pinnedExternalEmpIds.has(e.id)) inGrid.push(e);
            else external.push(e);
        }
        return { inGrid: inGrid.slice(0, 8), external: external.slice(0, 8) };
    }, [employees, deferredSearchTerm, displayedEmployees, pinnedExternalEmpIds]);

    const scrollToEmployeeRow = useCallback((empId: string) => {
        setHighlightEmpId(empId);
        requestAnimationFrame(() => {
            document.getElementById(`plan-emp-${empId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
        window.setTimeout(() => {
            setHighlightEmpId((prev) => (prev === empId ? null : prev));
        }, 2500);
    }, []);

    useEffect(() => {
        if (!forceShowAll) return;
        const poolIds = new Set(dotacionPoolCandidates.map((e: any) => e.id));
        if (poolIds.size === 0) return;
        const toPin: string[] = [];
        for (const key of Object.keys(pendingChanges)) {
            const entry = pendingChanges[key];
            if (!entry || entry.isDeleted) continue;
            const sep = key.lastIndexOf('_');
            const empId = sep > 0 ? key.slice(0, sep) : '';
            if (empId && poolIds.has(empId)) toPin.push(empId);
        }
        if (toPin.length === 0) return;
        setPinnedExternalEmpIds((prev) => {
            let changed = false;
            const next = new Set(prev);
            toPin.forEach((id) => {
                if (!next.has(id)) {
                    next.add(id);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [forceShowAll, pendingChanges, dotacionPoolCandidates]);

    // Horas por código custom (RO, RON, etc.) según definición del SLA activo.
    // Fallback en calcShiftHours para turnos guardados sin campo `hours` explícito.
    const slaCodeHoursHint = useMemo(() => {
        const hint: Record<string, number> = {};
        const parseH = (t: string) => { const m = t.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] + +m[2] / 60 : null; };
        positionStructure.forEach((pos: any) => {
            (pos.shifts || []).forEach((sh: any) => {
                const code = String(sh.code || '').toUpperCase();
                if (!code || PLANNING_NON_BILLABLE_CODES.has(code)) return;
                const n = Number(sh.hours);
                if (n > 0) { hint[code] = n; return; }
                if (typeof sh.startTime === 'string' && typeof sh.endTime === 'string') {
                    const s = parseH(sh.startTime), e = parseH(sh.endTime);
                    if (s !== null && e !== null) {
                        let dur = e - s; if (dur <= 0) dur += 24;
                        if (dur > 0) hint[code] = dur;
                    }
                }
            });
        });
        return hint;
    }, [positionStructure]);

    const planningSlaExclusion = useMemo(() => {
        if (!activePlanningSlaRow) return undefined;
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth();
        return buildSlaExclusionContext(
            [activePlanningSlaRow],
            new Date(y, m, 1),
            new Date(y, m + 1, 0, 23, 59, 59, 999),
        );
    }, [activePlanningSlaRow, currentDate]);

    const isShiftExcludedFromSlaBillable = (shift: any, dateStr: string, shiftPos: string) => {
        const scheduleDateKey = resolveTurnoScheduleDateKey(shift) || dateStr;
        if (planningSlaExclusion) {
            return isTurnoOnSlaExcludedSlot(shift, planningSlaExclusion, {
                scheduleDateKey,
                positionName: shiftPos,
            });
        }
        const posConfig = shiftPos
            ? positionStructure.find((p: any) => p.positionName === shiftPos)
            : undefined;
        if (posConfig?.positionExcludedDates?.includes(scheduleDateKey)) return true;
        return false;
    };

    /** Objetivos multi-puesto: ordenar dotación por puesto al entrar al cronograma. */
    useEffect(() => {
        if (!selectedObjective || positionStructure.length <= 1) return;
        const key = `${selectedObjective}__${positionStructure.map((p: any) => p.positionName).join('|')}`;
        if (objectiveSortAppliedRef.current === key) return;
        objectiveSortAppliedRef.current = key;
        setSortBy('position');
        setSortDir('asc');
    }, [selectedObjective, positionStructure]);

    const empMonthlyHours = useMemo(() => {
        const result: Record<string, number> = {};
        const _grupoObjIds = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        displayedEmployees.forEach((emp: any) => {
            let total = 0;
            const assignedPos = String(emp.assignedPosition || '').trim();
            const ctx: PlanningCellHoursContext = {
                selectedObjective,
                grupoObjectiveIds: _grupoObjIds,
                slaCodeHoursHint,
                isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                assignedPositionForEmp: () => assignedPos,
            };
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const turnos = resolveTurnosForPlanningCellKey({
                    empId: emp.id,
                    dateStr,
                    pending: pendingChanges[key],
                    cellTurnos: cellTurnosMap[key],
                    resolveSingleAtObjective: () =>
                        resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap),
                    ctx,
                });
                total += billableHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
            });
            result[emp.id] = total;
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, cellTurnosMap, selectedObjective, slaCodeHoursHint, positionStructure, selectedGrupo, grupoUnifiedMode, planningSlaExclusion]);

    /** Tramos ext/adel del mes (no cierran contra horas vendidas SLA). */
    const objectiveMonthCoverageExtraHours = useMemo(() => {
        let extra = 0;
        const _grupoObjIds = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        displayedEmployees.forEach((emp: any) => {
            const assignedPos = String(emp.assignedPosition || '').trim();
            const ctx: PlanningCellHoursContext = {
                selectedObjective,
                grupoObjectiveIds: _grupoObjIds,
                slaCodeHoursHint,
                isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                assignedPositionForEmp: () => assignedPos,
            };
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const turnos = resolveTurnosForPlanningCellKey({
                    empId: emp.id,
                    dateStr,
                    pending: pendingChanges[key],
                    cellTurnos: cellTurnosMap[key],
                    resolveSingleAtObjective: () =>
                        resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap),
                    ctx,
                });
                const gross = billableHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
                if (gross <= 0) return;
                const net = slaBaseHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
                extra += Math.max(0, gross - net);
            });
        });
        return Math.round(extra * 10) / 10;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, cellTurnosMap, selectedObjective, slaCodeHoursHint, positionStructure, selectedGrupo, grupoUnifiedMode, planningSlaExclusion]);

    /** Horas base del mes (misma regla que cierre vs vendidas SLA — sin tramos ext/adel). */
    const objectiveMonthSlaBaseHours = useMemo(() => {
        let base = 0;
        const _grupoObjIds = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        displayedEmployees.forEach((emp: any) => {
            const assignedPos = String(emp.assignedPosition || '').trim();
            const ctx: PlanningCellHoursContext = {
                selectedObjective,
                grupoObjectiveIds: _grupoObjIds,
                slaCodeHoursHint,
                isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                assignedPositionForEmp: () => assignedPos,
            };
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const turnos = resolveTurnosForPlanningCellKey({
                    empId: emp.id,
                    dateStr,
                    pending: pendingChanges[key],
                    cellTurnos: cellTurnosMap[key],
                    resolveSingleAtObjective: () =>
                        resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap),
                    ctx,
                });
                base += slaBaseHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
            });
        });
        return Math.round(base * 10) / 10;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, cellTurnosMap, selectedObjective, slaCodeHoursHint, positionStructure, selectedGrupo, grupoUnifiedMode, planningSlaExclusion]);

    const planningMonthHoursBreakdown = useMemo(() => {
        const _grupoObjIds = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        return computePlanningMonthHoursBreakdown({
            displayedEmployees,
            daysInMonth,
            getDateKey,
            resolveCellTurnos: (empId, dateStr) => {
                const key = `${empId}_${dateStr}`;
                const ctx: PlanningCellHoursContext = {
                    selectedObjective,
                    grupoObjectiveIds: _grupoObjIds,
                    slaCodeHoursHint,
                    isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                };
                return resolveTurnosForPlanningCellKey({
                    empId,
                    dateStr,
                    pending: pendingChanges[key],
                    cellTurnos: cellTurnosMap[key],
                    resolveSingleAtObjective: () =>
                        resolveCellShiftAtObjective(empId, dateStr, selectedObjective, pendingChanges, shiftsMap),
                    ctx,
                });
            },
            cellHoursCtxForEmp: (emp) => ({
                selectedObjective,
                grupoObjectiveIds: _grupoObjIds,
                slaCodeHoursHint,
                isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                assignedPositionForEmp: () => String(emp.assignedPosition || '').trim(),
            }),
        });
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, cellTurnosMap, selectedObjective, slaCodeHoursHint, selectedGrupo, grupoUnifiedMode, planningSlaExclusion]);

    const planningAuxiliarySummary = useMemo(() => {
        if (!Array.isArray(activePlanningSlaRow?.positions) || activePlanningSlaRow.positions.length === 0) return null;
        const positions = Array.isArray(activePlanningSlaRow.positions) ? activePlanningSlaRow.positions : [];
        const y = currentDate.getFullYear();
        const m = currentDate.getMonth();
        const start = toYyyyMmDd(activePlanningSlaRow.startDate) || '';
        const end = toYyyyMmDd(activePlanningSlaRow.endDate) || '';
        const ex = activePlanningSlaRow.excludedDates as string[] | undefined;
        let encContract = 0;
        let encInSla = 0;
        const hasEnc = positions.some((p: any) => isEncargadoPosition(p));
        const hasEvt = positions.some((p: any) => isEventosPosition(p));
        for (const pos of positions) {
            if (!isEncargadoPosition(pos)) continue;
            const h = calculatePositionMonthHours(pos, start, end, ex, y, m);
            encContract += h;
            if (positionIncludeInSlaTotals(pos)) encInSla += h;
        }
        const encPlanned = Math.round((planningMonthHoursBreakdown.byCodeGross['ENC'] || 0) * 10) / 10;
        const evtFromGrid = Math.round(((planningMonthHoursBreakdown.byCodeGross['EVT'] || 0) + (planningMonthHoursBreakdown.byCodeGross['EV'] || 0)) * 10) / 10;
        const monthPrefixEvt = `${y}-${String(m + 1).padStart(2, '0')}`;
        const turaEventosHrs = Object.values(turaMap)
            .filter((t: any) => t.objectiveId === selectedObjective && String(t.fecha || '').startsWith(monthPrefixEvt))
            .filter((t: any) => isEventosPosition({ name: t.positionName, coverageType: 'eventos' }))
            .reduce((a: number, t: any) => a + (Number(t.hours) || 0), 0);
        const evtPlanned = Math.round((evtFromGrid + turaEventosHrs) * 10) / 10;
        return {
            hasEnc,
            hasEvt,
            encContract: Math.round(encContract * 10) / 10,
            encInSla: Math.round(encInSla * 10) / 10,
            encPlanned,
            evtPlanned,
        };
    }, [activePlanningSlaRow, currentDate, planningMonthHoursBreakdown, turaMap, selectedObjective]);

    /** Facturable por sede (grupo unificado): suma turnos con objectiveId de cada objetivo — debe cerrar con grupoTotalVendidas. */
    const grupoObjectiveBillableHours = useMemo(() => {
        if (!selectedGrupo || !grupoUnifiedMode) return null;
        const acc: Record<string, number> = {};
        for (const objId of selectedGrupo.objectiveIds) acc[objId] = 0;
        displayedEmployees.forEach((emp: any) => {
            const assignedPos = String(emp.assignedPosition || '').trim();
            daysInMonth.forEach((day) => {
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                for (const objId of selectedGrupo.objectiveIds) {
                    const ctx: PlanningCellHoursContext = {
                        selectedObjective: objId,
                        grupoObjectiveIds: null,
                        slaCodeHoursHint,
                        isExcludedFromBillable: isShiftExcludedFromSlaBillable,
                        assignedPositionForEmp: () => assignedPos,
                    };
                    const turnos = resolveTurnosForPlanningCellKey({
                        empId: emp.id,
                        dateStr,
                        pending: pendingChanges[key],
                        cellTurnos: cellTurnosMap[key],
                        resolveSingleAtObjective: () =>
                            resolveCellShiftAtObjective(emp.id, dateStr, objId, pendingChanges, shiftsMap),
                        ctx,
                    });
                    acc[objId] += billableHoursForPlanningCell(turnos, dateStr, emp.id, ctx);
                }
            });
        });
        const rounded: Record<string, number> = {};
        for (const objId of selectedGrupo.objectiveIds) {
            rounded[objId] = Math.round(acc[objId] * 10) / 10;
        }
        return rounded;
    }, [
        selectedGrupo,
        grupoUnifiedMode,
        displayedEmployees,
        daysInMonth,
        pendingChanges,
        shiftsMap,
        cellTurnosMap,
        slaCodeHoursHint,
        planningSlaExclusion,
    ]);

    // Días RET por empleado (0 h planificadas — sobrante disponible en otro objetivo).
    const empRetDays = useMemo(() => {
        const result: Record<string, number> = {};
        const _grupoObjIdsRet = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        displayedEmployees.forEach((emp: any) => {
            let count = 0;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                if (pending?.isDeleted) return;
                const activeShift = pending && !pending.isDeleted ? pending : existing;
                if (!activeShift) return;
                if (_grupoObjIdsRet) {
                    const ao = String(activeShift.objectiveId || '');
                    if (!ao || !_grupoObjIdsRet.includes(ao)) return;
                    if (isOperationalOriginShift(activeShift)) return;
                } else if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
                if (String(activeShift.code || '').toUpperCase() === 'RET') count++;
            });
            result[emp.id] = count;
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, selectedGrupo, grupoUnifiedMode]);

    // Celdas con descanso insuficiente (<12h o <35h post-racha) respecto a turnos adyacentes.
    const restViolationCells = useMemo(() => {
        const violated = new Set<string>();
        if (!displayedEmployees.length || !daysInMonth.length) return violated;
        const NON_WORK = new Set(['F','FF','FP','FT','V','L','A','E','PG','AA','RET']);
        const getShift = (empId: string, ds: string) => {
            const k = `${empId}_${ds}`;
            const p = pendingChanges[k];
            if (p) return p.isDeleted ? null : p;
            return shiftsMap[k] || null;
        };
        const cfg = { minRestBetweenShiftsHours: 12, longRestAfterWorkedHours: 48, minLongRestHours: 35 };
        for (const emp of displayedEmployees as any[]) {
            for (const day of daysInMonth) {
                const dateStr = getDateKey(day);
                const sh = getShift(emp.id, dateStr);
                if (!sh || sh.isDeleted) continue;
                const code = String(sh.code || '').toUpperCase();
                if (NON_WORK.has(code)) continue;
                const violation = checkRestBetweenShifts({
                    empId: emp.id, targetDateStr: dateStr,
                    proposed: { code, startTime: sh.startTime || undefined, hours: Number(sh.hours) || undefined },
                    getShift, cfg,
                });
                if (violation) violated.add(`${emp.id}_${dateStr}`);
            }
        }
        return violated;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap]);

    // Horas en el ciclo CCT actual (corre del 26 del mes anterior al 25 del mes activo).
    // Suma:
    //   - Cola del mes anterior (días 26..fin) → tomada de shiftsMap (no editable acá).
    //   - Días 1..25 del mes activo → toma pendingChanges si existe, si no shiftsMap.
    // Filtra códigos que no suman horas planificadas (RET, REF, ESC, F, FF, FP, FT, V, L, etc.).
    const empCctCurrentHours = useMemo(() => {
        const result: Record<string, number> = {};
        const yr = currentDate.getFullYear();
        const mo = currentDate.getMonth();
        // Cola del mes anterior: 26..fin
        const prevMonthDate = new Date(yr, mo - 1, 1);
        const prevYr = prevMonthDate.getFullYear();
        const prevMo = prevMonthDate.getMonth();
        const prevLast = new Date(yr, mo, 0).getDate();
        const tailDays: Date[] = [];
        for (let d = 26; d <= prevLast; d++) tailDays.push(new Date(prevYr, prevMo, d));
        // Mes activo: días 1..25
        const headDays = daysInMonth.filter((d: Date) => d.getDate() <= 25);
        const _grupoObjIdsCct = selectedGrupo && grupoUnifiedMode ? selectedGrupo.objectiveIds : null;
        const _shiftBelongsToContext = (shift: any) => {
            if (!shift) return false;
            if (isOperationalOriginShift(shift)) return false;
            const ao = String(shift.objectiveId || '');
            if (!ao) return false;
            return _grupoObjIdsCct ? _grupoObjIdsCct.includes(ao) : ao === String(selectedObjective);
        };
        const acumular = (empId: string, key: string, useShiftsMap: boolean) => {
            const pending = pendingChanges[key];
            const existing = shiftsMap[key];
            let activeShift: any = null;
            if (useShiftsMap) {
                activeShift = existing;
                if (!_shiftBelongsToContext(activeShift)) return;
            } else if (pending && !pending.isDeleted) {
                activeShift = pending;
                if (activeShift.objectiveId != null && activeShift.objectiveId !== '') {
                    const ao = String(activeShift.objectiveId);
                    const ok = _grupoObjIdsCct ? _grupoObjIdsCct.includes(ao) : ao === String(selectedObjective);
                    if (!ok) return;
                }
            } else {
                activeShift = existing;
                if (!_shiftBelongsToContext(activeShift)) return;
            }
            if (!activeShift) return;
            if (!shiftCountsForEmployeeCronoHours(activeShift)) return;
            result[empId] = (result[empId] || 0) + calcShiftHours(activeShift, slaCodeHoursHint);
        };
        displayedEmployees.forEach((emp: any) => {
            result[emp.id] = 0;
            tailDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, true));
            headDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, false));
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, currentDate, selectedObjective, slaCodeHoursHint, selectedGrupo, grupoUnifiedMode]);

    /** Conteos del mes basados en turnos reales del objetivo (no tamaño de dotación asignada). */
    const objectiveMonthShiftMetrics = useMemo(() => {
        const withBillableHours = new Set<string>();
        const withRetAtObjective = new Set<string>();
        let totalRetDays = 0;
        if (!selectedObjective) {
            return { empCountWithTurnos: 0, empCountBillable: 0, totalRetDays: 0 };
        }
        displayedEmployees.forEach((emp: any) => {
            if (!isEmployeeNativeToObjective(emp)) return;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const activeShift = resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap);
                if (!activeShift) return;
                const code = String(activeShift.code || activeShift.shiftCode || '').toUpperCase();
                if (code === 'RET') {
                    totalRetDays++;
                    withRetAtObjective.add(emp.id);
                    return;
                }
                if (shiftCountsForEmployeeCronoHours(activeShift) && calcShiftHours(activeShift, slaCodeHoursHint) > 0) {
                    withBillableHours.add(emp.id);
                }
            });
        });
        const withTurnos = new Set<string>([...withBillableHours, ...withRetAtObjective]);
        return {
            empCountWithTurnos: withTurnos.size,
            empCountBillable: withBillableHours.size,
            totalRetDays,
        };
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, slaCodeHoursHint, isEmployeeNativeToObjective]);

    const retCount = useMemo(() => objectiveMonthShiftMetrics.totalRetDays, [objectiveMonthShiftMetrics.totalRetDays]);

    /** Dotación estructural necesaria para 6+2, calculada desde positionStructure (sin correr el motor). */
    const staffingReq6x2 = useMemo(() => {
        if (!positionStructure.length) return null;
        const FACTOR = 8 / 6;
        const perPos = positionStructure.map((pos: any) => {
            const qty = Math.max(1, Number(pos.qty) || 1);
            const cov = String(pos.coverageType || '').toLowerCase();
            const is24h = cov === '24hs' || cov === '24' || cov === '24h';
            const bandsPerDay = is24h ? 3 : Math.max(1, (pos.shifts || []).length);
            const slotsPerDay = qty * bandsPerDay;
            const needed = is24h ? Math.ceil(slotsPerDay * FACTOR) : slotsPerDay;
            return { positionName: pos.positionName, qty, is24h, bandsPerDay, needed };
        });
        const totalNeeded = perPos.reduce((s: number, p: any) => s + p.needed, 0);
        return { perPos, totalNeeded };
    }, [positionStructure]);

    const objectiveCronogramRules = useMemo(() => {
        if (!positionStructure?.length) return null;
        return resolveCronogramPlanningRules(positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[]);
    }, [positionStructure]);

    const objectiveServiceAnalysis = useMemo(() => {
        if (!positionStructure?.length) return null;
        const cycle = autoPlanningBrainReport?.pickedCycle
            ?? buildObjectiveScheduleProfile(positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[]).cyclePreference[0]
            ?? '6+2';
        return buildObjectiveServiceAnalysis(
            positionStructure as import('@/lib/planificacion/autoScheduleEngineV2').V2PositionDef[],
            cycle,
        );
    }, [positionStructure, autoPlanningBrainReport?.pickedCycle]);

    // Colchón disponible (horas): si hoy se ausenta alguien, ¿cuánto se podría cubrir
    // promoviendo RETs a turno facturable sin pasar 200h por empleado?
    // Estimación: 8h por RET (turno típico), limitada por la capacidad restante de
    // cada empleado hasta 200h. Pesimista pero segura.
    const retBufferHours = useMemo(() => {
        let total = 0;
        displayedEmployees.forEach((emp: any) => {
            let empRetCount = 0;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const activeShift = resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap);
                if (activeShift && String(activeShift.code || '').toUpperCase() === 'RET') empRetCount++;
            });
            if (empRetCount === 0) return;
            const monthH = empMonthlyHours[emp.id] || 0;
            const spareToCap = Math.max(0, 200 - monthH);
            total += Math.min(empRetCount * 8, spareToCap);
        });
        return total;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, empMonthlyHours, selectedObjective]);

    // Calcula las horas totales de descanso de un bloque de francos consecutivos.
    // Incluye: horas restantes tras el último turno trabajado + 24h × días de franco + horas hasta el próximo turno.
    const calcFrancoRestHours = (empId: string, di: number): number | null => {
        const REST_CODES = new Set(['F','FF','FP','FT','V','L','A','E','AA','PG','RET']);
        const getShiftAt = (dayIdx: number) => {
            const day = daysInMonth[dayIdx];
            if (!day) return null;
            const key = `${empId}_${getDateKey(day)}`;
            const p = pendingChanges[key];
            const s = shiftsMap[key];
            return (p && !p.isDeleted) ? p : (s || null);
        };
        const isRestAt = (dayIdx: number): boolean => {
            const sh = getShiftAt(dayIdx);
            if (!sh) return false;
            return REST_CODES.has(String(sh.code||'').toUpperCase());
        };
        // Extender el bloque de francos en ambas direcciones
        let blockStart = di;
        while (blockStart > 0 && isRestAt(blockStart - 1)) blockStart--;
        let blockEnd = di;
        while (blockEnd < daysInMonth.length - 1 && isRestAt(blockEnd + 1)) blockEnd++;
        // Turno trabajado anterior al bloque (cualquier código no-franco, independiente de hours)
        let prevShift: any = null;
        for (let d = blockStart - 1; d >= 0; d--) {
            const sh = getShiftAt(d);
            if (sh && !sh.isFranco && !REST_CODES.has(String(sh.code||'').toUpperCase())) { prevShift = sh; break; }
        }
        // Turno trabajado posterior al bloque
        let nextShift: any = null;
        for (let d = blockEnd + 1; d < daysInMonth.length; d++) {
            const sh = getShiftAt(d);
            if (sh && !sh.isFranco && !REST_CODES.has(String(sh.code||'').toUpperCase())) { nextShift = sh; break; }
        }
        const blockDays = blockEnd - blockStart + 1;
        // Si no hay ningún turno adyacente, mostrar al menos la duración del bloque
        if (!prevShift && !nextShift) return blockDays * 24;
        const END_DEF:   Record<string,number> = { M:15, T:23, N:7, D12:19, N12:7 };
        const START_DEF: Record<string,number> = { M:7,  T:15, N:23, D12:7, N12:19 };
        const parseHour = (t: any): number | null => {
            if (!t || t === '00:00') return null;
            const parts = String(t).split(':').map(Number);
            const h = parts[0], m = parts[1] ?? 0;
            return isNaN(h) ? null : h + (m / 60);
        };
        // Configuración canónica del turno según el SLA (fuente más confiable)
        const getSLAShiftConfig = (code: string): any => {
            for (const pos of positionStructure) {
                const s = (pos.shifts || []).find((s: any) => String(s.code||'').toUpperCase() === code);
                if (s) return s;
            }
            return null;
        };
        const getEndH = (sh: any): number => {
            const code = String(sh?.code||'').toUpperCase();
            // 1) endTime del propio registro
            const fromEnd = parseHour(sh?.endTime);
            if (fromEnd !== null) return fromEnd;
            // 2) startTime + hours del registro (solo si hours > 0)
            const fromStart = parseHour(sh?.startTime);
            const hrs = Number(sh?.hours);
            if (fromStart !== null && hrs > 0) return (fromStart + hrs) % 24;
            // 3) configuración canónica del SLA
            const cfg = getSLAShiftConfig(code);
            if (cfg) {
                const cfgEnd = parseHour(cfg.endTime);
                if (cfgEnd !== null) return cfgEnd;
                const cfgStart = parseHour(cfg.startTime);
                const cfgHrs = Number(cfg.hours);
                if (cfgStart !== null && cfgHrs > 0) return (cfgStart + cfgHrs) % 24;
            }
            return END_DEF[code] ?? 15;
        };
        const getStartH = (sh: any): number => {
            const code = String(sh?.code||'').toUpperCase();
            // 1) startTime del registro
            const fromRecord = parseHour(sh?.startTime);
            if (fromRecord !== null) return fromRecord;
            // 2) configuración canónica del SLA
            const cfg = getSLAShiftConfig(code);
            if (cfg) {
                const cfgStart = parseHour(cfg.startTime);
                if (cfgStart !== null) return cfgStart;
            }
            return START_DEF[code] ?? 7;
        };
        // Turnos nocturnos (N, N12) terminan en el día siguiente.
        // En ese caso el primer día del bloque ya está contado en hoursAfterPrev,
        // por lo que se resta 1 para evitar el doble-cómputo.
        const prevEndH   = prevShift ? getEndH(prevShift) : null;
        const prevStartH = prevShift ? getStartH(prevShift) : null;
        const prevIsOvernight = prevEndH !== null && prevStartH !== null && prevEndH < prevStartH;
        const effectiveBlockDays = (prevShift && prevIsOvernight) ? Math.max(0, blockDays - 1) : blockDays;
        const hoursAfterPrev  = prevShift && prevEndH != null && !isNaN(prevEndH) ? (24 - prevEndH) : 0;
        const hoursBeforeNext = nextShift ? getStartH(nextShift) : 0;
        const total = hoursAfterPrev + effectiveBlockDays * 24 + hoursBeforeNext;
        return isNaN(total) ? blockDays * 24 : Math.round(total);
    };

    // ============================================================================
    // 4. LÓGICA DERIVADA (NIVEL 3)
    // ============================================================================

    const dominantPosition = useMemo(() => {
        if (positionStructure.length === 0) return { qty: 1, positionName: 'General' };
        return positionStructure.reduce((prev, current) => (Number(prev.qty || 0) > Number(current.qty || 0)) ? prev : current, positionStructure[0]);
    }, [positionStructure]);

    const STANDARD_SHIFTS_BASE = [
        { code: 'M',   name: 'Mañana',       hours: 8,  startTime: '07:00', endTime: '15:00' },
        { code: 'T',   name: 'Tarde',         hours: 8,  startTime: '15:00', endTime: '23:00' },
        { code: 'N',   name: 'Noche',         hours: 8,  startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'Diurno 12h',    hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'Nocturno 12h',  hours: 12, startTime: '19:00', endTime: '07:00' },
    ];

    /** Objetivo destino al planificar una celda (grupo unificado: selector o nativo del empleado). */
    const cellPlanningObjectiveId = useMemo(() => {
        if (!selectedObjective) return null;
        if (!selectedGrupo || !grupoUnifiedMode) return selectedObjective;
        if (cellTargetObjectiveId) return cellTargetObjectiveId;
        if (selectedCell?.currentShift?.objectiveId) {
            const oid = String(selectedCell.currentShift.objectiveId);
            if (selectedGrupo.objectiveIds.includes(oid)) return oid;
        }
        if (selectedCell?.empId) {
            const emp = employees.find((e: any) => e.id === selectedCell.empId);
            if (emp) {
                if (selectedGrupo.objectiveIds.includes(emp.preferredObjectiveId)) return emp.preferredObjectiveId;
                const mapped = slaIdToObjId[emp.preferredObjectiveId];
                if (mapped && selectedGrupo.objectiveIds.includes(mapped)) return mapped;
            }
        }
        return selectedGrupo.objectiveIds[0] ?? selectedObjective;
    }, [selectedObjective, selectedGrupo, grupoUnifiedMode, cellTargetObjectiveId, selectedCell, employees, slaIdToObjId]);

    // En modo grupo unificado: SLA del objetivo elegido en el modal (no siempre el 1º del grupo)
    const effectivePosStructure = useMemo(() => {
        if (selectedGrupo && grupoUnifiedMode && cellPlanningObjectiveId && Object.keys(grupoSlaMap).length > 0) {
            const struct = grupoSlaMap[cellPlanningObjectiveId];
            if (struct?.length) return struct;
        }
        return positionStructure;
    }, [selectedGrupo, grupoUnifiedMode, cellPlanningObjectiveId, grupoSlaMap, positionStructure]);

    const uniqueSLAShifts = useMemo(() => {
        const targetPos = activePosition || (effectivePosStructure.length > 0 ? effectivePosStructure[0].positionName : 'General');
        const pos = effectivePosStructure.find((p: any) => p.positionName === targetPos);
        return pos ? pos.shifts : [];
    }, [effectivePosStructure, activePosition]);

    /** Turnos visibles en el modal del día: solo bandas activas ese día + F/RET/REF/ESC. */
    const modalDayShifts = useMemo(() => {
        if (!selectedCell?.dateStr || !uniqueSLAShifts.length) return uniqueSLAShifts;
        const posName = activePosition || effectivePosStructure[0]?.positionName || 'General';
        const pos = effectivePosStructure.find((p: any) => p.positionName === posName);
        if (!pos) return uniqueSLAShifts;
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;
        return filterShiftsForPlanningDay(
            uniqueSLAShifts,
            pos,
            getDayLetter(selectedCell.dateStr),
            selectedCell.dateStr,
            cycles,
        );
    }, [uniqueSLAShifts, selectedCell?.dateStr, activePosition, effectivePosStructure, autoCycles]);

    const genderRestrictedPositionsCount = useMemo(
        () => positionStructure.filter((p: any) => getPreferenciaGeneroUi(p.preferenciaGenero)).length,
        [positionStructure],
    );

    const renderPositionGeneroBadge = (pref: unknown, extraClass = '') => {
        const ui = getPreferenciaGeneroUi(pref);
        if (!ui) return null;
        return <span className={`${ui.badgeClass} ${extraClass}`.trim()} title={ui.title}>{ui.label}</span>;
    };

    // Turnos para la barra flotante de selección múltiple.
    // Combina turnos de todas las posiciones; si un código es de un solo puesto, guarda positionName.
    // Si ninguna posición tiene M/T/N/D12/N12, agrega los estándar como base mínima.
    // En grupo: si la selección es de un solo objetivo, solo el SLA de ese objetivo.
    const bulkEffectiveStructure = useMemo(() => {
        if (selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0) {
            if (bulkBarScopeObjectiveId && (grupoSlaMap[bulkBarScopeObjectiveId]?.length || 0) > 0) {
                return grupoSlaMap[bulkBarScopeObjectiveId];
            }
            if (bulkBarScopeObjectiveId) return positionStructure;
            const byName = new Map<string, any>();
            for (const objId of selectedGrupo.objectiveIds) {
                for (const p of (grupoSlaMap[objId] || [])) {
                    if (!byName.has(p.positionName)) byName.set(p.positionName, p);
                }
            }
            if (byName.size > 0) return [...byName.values()];
        }
        return positionStructure;
    }, [selectedGrupo, grupoUnifiedMode, grupoSlaMap, positionStructure, bulkBarScopeObjectiveId]);

    const bulkShifts = useMemo(() => {
        const STANDARD_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);
        const byCode = new Map<string, any>();
        let sourcePositions: any[] = positionStructure || [];
        if (selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0) {
            if (bulkBarScopeObjectiveId) {
                sourcePositions = grupoSlaMap[bulkBarScopeObjectiveId]?.length
                    ? grupoSlaMap[bulkBarScopeObjectiveId]
                    : (positionStructure || []);
            } else {
                sourcePositions = selectedGrupo.objectiveIds.flatMap((objId: string) => grupoSlaMap[objId] || []);
            }
        }
        for (const pos of sourcePositions) {
            for (const s of (pos.shifts || []) as any[]) {
                const codeKey = String(s.code || '').toUpperCase();
                if (!codeKey) continue;
                const prev = byCode.get(codeKey);
                if (!prev) {
                    byCode.set(codeKey, {
                        code: s.code,
                        name: s.name,
                        hours: s.hours,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        positionName: pos.positionName,
                        ownerCount: 1,
                    });
                } else {
                    prev.ownerCount = (prev.ownerCount || 1) + 1;
                    prev.positionName = undefined;
                }
            }
        }
        const deduped = [...byCode.values()];
        const base = deduped.length > 0 ? deduped : uniqueSLAShifts;
        const hasStandard = base.some((s: any) => STANDARD_CODES.has(String(s.code || '').toUpperCase()));
        if (hasStandard) return base;
        // No inyectar estándar si todos los puestos del SLA son custom (evita M/T/N en SLAs custom-only)
        const allCustomCoverage = sourcePositions.length > 0
            && sourcePositions.every((p: any) => p.coverageType === 'custom');
        if (allCustomCoverage) return base;
        const existingCodes = new Set(base.map((s: any) => String(s.code || '').toUpperCase()));
        const missing = STANDARD_SHIFTS_BASE.filter(s => !existingCodes.has(s.code));
        return [...missing, ...base];
    }, [uniqueSLAShifts, positionStructure, selectedGrupo, grupoUnifiedMode, grupoSlaMap, bulkBarScopeObjectiveId]);

    /** Mono-objetivo (o selección de un solo objetivo en grupo): puesto vs elegir en la barra. */
    const bulkMonoPositionInfo = useMemo(() => {
        const empty = {
            needsPick: false,
            resolvedPos: null as string | null,
            resolvedPositions: [] as string[],
            showPositionButtons: false,
            effectivePos: null as string | null,
            scopeObj: null as string | null,
            structure: [] as any[],
        };
        if (!selection.start || !selection.end) return empty;
        if (bulkPerEmpMode) return empty;
        const scopeObj = bulkBarScopeObjectiveId || selectedObjective;
        if (!scopeObj) return empty;

        const structure = (selectedGrupo && grupoUnifiedMode && grupoSlaMap[scopeObj]?.length)
            ? grupoSlaMap[scopeObj]
            : (bulkEffectiveStructure?.length ? bulkEffectiveStructure : positionStructure);

        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);
        const resolved = new Set<string>();
        let missing = 0;
        let checked = 0;

        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            for (let c = minC; c <= maxC; c++) {
                const day = daysInMonth[c];
                if (!day) continue;
                checked++;
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const shift = pending ? (pending.isDeleted ? null : pending) : shiftsMap[key];
                const cellPos = shift?.positionName && !['General', 'Retén', ''].includes(String(shift.positionName))
                    ? String(shift.positionName)
                    : null;
                const defaultPos = empDefaultPos[`${emp.id}___${scopeObj}`]
                    || empDefaultPos[`${emp.id}___${selectedObjective}`]
                    || null;
                const pos = cellPos || defaultPos;
                if (pos) resolved.add(pos);
                else missing++;
            }
        }

        const resolvedPos = resolved.size === 1 ? [...resolved][0] : null;
        const resolvedPositions = [...resolved];
        const needsPick = missing > 0;
        const showPositionButtons = needsPick && (structure?.length || 0) > 0;
        const effectivePos = bulkBarPosition || resolvedPos || null;
        return { needsPick, resolvedPos, resolvedPositions, showPositionButtons, effectivePos, checked, scopeObj, structure };
    }, [
        selection.start, selection.end, selectedObjective, selectedGrupo, grupoUnifiedMode, bulkPerEmpMode,
        bulkBarScopeObjectiveId, grupoSlaMap, bulkEffectiveStructure, positionStructure,
        displayedEmployees, daysInMonth, pendingChanges, shiftsMap, empDefaultPos, bulkBarPosition,
    ]);

    /** Turnos de la barra mono filtrados por puesto efectivo (si hay). */
    const bulkMonoShifts = useMemo(() => {
        const structure = bulkMonoPositionInfo.structure || bulkEffectiveStructure || positionStructure;
        const posName = bulkMonoPositionInfo.effectivePos;
        if (posName && structure?.length) {
            const pos = structure.find((p: any) => p.positionName === posName);
            if (pos?.shifts?.length) {
                return (pos.shifts as any[]).map((s: any) => ({
                    code: s.code,
                    name: s.name,
                    hours: s.hours,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    positionName: pos.positionName,
                }));
            }
        }
        const multiPos = bulkMonoPositionInfo.resolvedPositions;
        if (multiPos && multiPos.length > 1 && structure?.length) {
            const byCode = new Map<string, any>();
            for (const pn of multiPos) {
                const pos = structure.find((p: any) => p.positionName === pn);
                for (const s of ((pos?.shifts || []) as any[])) {
                    const ck = String(s.code || '').toUpperCase();
                    if (!ck || byCode.has(ck)) continue;
                    byCode.set(ck, {
                        code: s.code,
                        name: s.name,
                        hours: s.hours,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        positionName: undefined,
                    });
                }
            }
            if (byCode.size > 0) return [...byCode.values()];
        }
        return bulkShifts;
    }, [bulkMonoPositionInfo, bulkEffectiveStructure, positionStructure, bulkShifts]);

    const getBulkEmpObjectiveId = useCallback((emp: { id: string }) => {
        if (selectedGrupo && grupoUnifiedMode) {
            return resolveNativeObjectiveInGrupo(emp)
                || bulkEmpObjectiveOverrides[emp.id]
                || bulkTargetObjectiveId
                || selectedGrupo.objectiveIds[0]
                || '';
        }
        return bulkBarScopeObjectiveId || selectedObjective || '';
    }, [
        selectedGrupo, grupoUnifiedMode, resolveNativeObjectiveInGrupo,
        bulkEmpObjectiveOverrides, bulkTargetObjectiveId, bulkBarScopeObjectiveId, selectedObjective,
    ]);

    /** Turnos SLA del guardia según su puesto asignado (o filtro UI si aún no tiene puesto). */
    const getBulkEmpShifts = useCallback((emp: { id: string }) => {
        const objId = getBulkEmpObjectiveId(emp);
        if (!objId) return bulkMonoShifts;
        const empPos = empDefaultPos[`${emp.id}___${objId}`]
            || resolveBulkPanelEmpPosition(emp, objId);
        const filterPos = bulkEmpPositionFilter[emp.id] || null;
        const posForShifts = empPos || filterPos || bulkBarPosition || null;
        if (posForShifts) {
            const fromPos = getShiftsForPosition(posForShifts, objId);
            if (fromPos.length > 0) return fromPos;
            // posForShifts obsoleto (puesto renombrado/eliminado del SLA): caer como sin puesto
        }
        // Sin puesto asignado: si el SLA tiene un único puesto, usarlo para todos
        const scopeStructure = (selectedGrupo && grupoUnifiedMode && objId && grupoSlaMap[objId]?.length)
            ? grupoSlaMap[objId] : positionStructure;
        if (scopeStructure?.length === 1 && (scopeStructure[0] as any)?.shifts?.length) {
            const sp = scopeStructure[0] as any;
            return (sp.shifts as any[]).map((s: any) => ({
                code: s.code, name: s.name, hours: s.hours,
                startTime: s.startTime, endTime: s.endTime,
                positionName: sp.positionName,
            }));
        }
        if (bulkPerEmpMode && selectedGrupo) return getShiftsForObjective(objId);
        return bulkMonoShifts;
    }, [
        getBulkEmpObjectiveId, empDefaultPos, resolveBulkPanelEmpPosition, bulkEmpPositionFilter,
        bulkBarPosition, getShiftsForPosition, bulkPerEmpMode, selectedGrupo,
        getShiftsForObjective, bulkMonoShifts, positionStructure, grupoSlaMap, grupoUnifiedMode,
    ]);

    /** Códigos apagados en barra mono: cupo lleno / esquema cerrado en todos los días de la selección. */
    const bulkMonoDisabledCodes = useMemo(() => {
        const disabled = new Map<string, string>();
        if (!selection.start || !selection.end) return disabled;
        if (bulkPerEmpMode) return disabled;
        const scopeObj = bulkBarScopeObjectiveId || selectedObjective;
        if (!scopeObj) return disabled;

        const structure = bulkMonoPositionInfo.structure || bulkEffectiveStructure || positionStructure || [];
        const posName = bulkMonoPositionInfo.effectivePos;
        const multiPos = bulkMonoPositionInfo.resolvedPositions;
        if (!posName && multiPos && multiPos.length > 1) {
            return disabled;
        }
        const evalPosName = posName || (structure?.[0]?.positionName) || 'General';
        const posCfg = structure.find((p: any) => p.positionName === evalPosName) || structure[0];
        if (!posCfg) return disabled;

        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);
        const pax = Math.max(1, Number(posCfg.qty) || 1);
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;
        const dominant = structure.reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            structure[0] || { qty: 1, positionName: 'General' },
        );

        const codes = new Set<string>();
        for (const s of bulkMonoShifts) {
            const c = String(s.code || '').toUpperCase();
            if (c && isPlanningWorkShiftCode(c)) codes.add(c);
        }

        for (const code of codes) {
            let blockedOnAllDays = true;
            let lastReason = '';
            for (let c = minC; c <= maxC; c++) {
                const day = daysInMonth[c];
                if (!day) continue;
                const dateStr = getDateKey(day);
                const dayLetter = getDayLetter(dateStr);
                if (!isPosActiveOnDay(posCfg, dayLetter, dateStr) || isPosExcludedOnDate(posCfg, dateStr)) {
                    lastReason = 'Puesto sin servicio ese día';
                    continue;
                }
                const codeCounts: Record<string, number> = {};
                const assigned: { code: string; hours: number }[] = [];
                displayedEmployees.forEach((e: any) => {
                    const key = `${e.id}_${dateStr}`;
                    const absence = absencesMap[key];
                    if (isEmployeeOnLeave({ shiftCode: pendingChanges[key]?.code || shiftsMap[key]?.code, absence })) return;
                    const pending = pendingChanges[key];
                    const shift = pending ? (pending.isDeleted ? null : pending) : shiftsMap[key];
                    if (!shift) return;
                    const effectiveObjId = resolveEffectiveShiftObjectiveId(e, shift, key);
                    if (String(effectiveObjId || '') !== String(scopeObj)) return;
                    const sc = String(shift.code || '').toUpperCase();
                    if (PLANNING_NON_BILLABLE_CODES.has(sc)) return;
                    const shiftPos = shift.positionName || dominant?.positionName || 'General';
                    if (shiftPos !== evalPosName) return;
                    codeCounts[sc] = (codeCounts[sc] || 0) + 1;
                    assigned.push({ code: sc, hours: resolveBandHours(sc, shift, posCfg.shifts || []) });
                });

                const units = countPositionClosedUnitsFromShifts(posCfg, dayLetter, codeCounts, cycles, true, dateStr);
                if (units.required > 0 && units.closed >= units.required) {
                    lastReason = 'Cobertura SLA completa';
                    continue;
                }
                const shiftCfgBulk = (posCfg?.shifts as any[])?.find((sh: any) => String(sh.code || '').toUpperCase() === code);
                const shiftPaxBulk = shiftCfgBulk?.quantity != null ? Math.max(1, Number(shiftCfgBulk.quantity)) : pax;
                if ((codeCounts[code] || 0) >= shiftPaxBulk) {
                    lastReason = `Cupo ${code} completo (${shiftPaxBulk} pax)`;
                    continue;
                }
                if (is24hCoverageType(posCfg)) {
                    const bandH = resolveBandHours(code, { hours: SHIFT_HOURS_LOOKUP[code] || 8 }, posCfg.shifts || []);
                    if (is24hsSinglePaxBandMixBlocked(pax, code, assigned, bandH)) {
                        lastReason = 'Esquema 24hs: no mezclar 8h y 12h en el mismo pax';
                        continue;
                    }
                }
                blockedOnAllDays = false;
                break;
            }
            if (blockedOnAllDays) disabled.set(code, lastReason || 'Sin cupo disponible');
        }
        // Chequear restricciones de cobertura (positionAssignments) por empleado en la selección
        if (activeSlaPositionAssignments?.length && evalPosName) {
            const minRBulk = Math.min(selection.start.r, selection.end.r);
            const maxRBulk = Math.max(selection.start.r, selection.end.r);
            for (const code of codes) {
                if (disabled.has(code)) continue;
                let hasBlocked = false;
                let hasAllowed = false;
                for (let r = minRBulk; r <= maxRBulk; r++) {
                    const selEmp = displayedEmployees[r];
                    if (!selEmp) continue;
                    const pa = activeSlaPositionAssignments.find((a: any) => a.employeeId === selEmp.id);
                    if (!pa?.slots?.length) { hasAllowed = true; continue; }
                    const sl = pa.slots.find((s: any) => s.positionName === evalPosName);
                    if (!sl || (sl.shiftCodes.length > 0 && !sl.shiftCodes.map((x: string) => x.toUpperCase()).includes(code))) {
                        hasBlocked = true;
                    } else {
                        hasAllowed = true;
                    }
                }
                if (hasBlocked && !hasAllowed) disabled.set(code, 'Cobertura: turno no permitido para los empleados seleccionados');
            }
        }
        return disabled;
    }, [
        selection.start, selection.end, selectedObjective, bulkPerEmpMode, bulkBarScopeObjectiveId,
        bulkMonoPositionInfo, bulkEffectiveStructure, positionStructure, bulkMonoShifts, daysInMonth,
        displayedEmployees, pendingChanges, shiftsMap, absencesMap, autoCycles, resolveEffectiveShiftObjectiveId,
        activeSlaPositionAssignments,
    ]);

    /** Puestos visibles en la barra bulk según positionAssignments de los empleados seleccionados. null = mostrar todos. */
    const bulkBarVisiblePositionNames = useMemo((): Set<string> | null => {
        if (!activeSlaPositionAssignments?.length) return null;
        if (!selection.start || !selection.end) return null;
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const visible = new Set<string>();
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            const pa = activeSlaPositionAssignments.find((a: any) => a.employeeId === emp.id);
            if (!pa?.slots?.length) return null;
            for (const slot of pa.slots) {
                if (slot.positionName) visible.add(slot.positionName);
            }
        }
        return visible.size > 0 ? visible : null;
    }, [activeSlaPositionAssignments, selection.start, selection.end, displayedEmployees]);

    /**
     * Mono-objetivo: multiselección con 2+ guardias → panel por colaborador
     * (turnos del SLA de cada puesto; no exige puesto único en toda la selección).
     */
    const bulkMonoPerEmpMode = useMemo(() => {
        if (bulkPerEmpMode) return false;
        if (bulkSelectionEmployees.length < 2) return false;
        return !!(bulkBarScopeObjectiveId || selectedObjective);
    }, [bulkPerEmpMode, bulkSelectionEmployees.length, bulkBarScopeObjectiveId, selectedObjective]);

    const bulkShowPerEmpPanel = bulkPerEmpMode || bulkMonoPerEmpMode;

    const bulkHeaderShiftPool = useMemo(() => {
        if (bulkBarPosition) {
            const objId = bulkBarScopeObjectiveId || selectedObjective;
            if (objId) {
                const fromPos = getShiftsForPosition(bulkBarPosition, objId);
                if (fromPos.length > 0) return fromPos;
            }
        }
        if (bulkMonoPerEmpMode) return bulkMonoShifts;
        return bulkShifts;
    }, [
        bulkBarPosition, bulkBarScopeObjectiveId, selectedObjective, getShiftsForPosition,
        bulkMonoPerEmpMode, bulkMonoShifts, bulkShifts,
    ]);

    /** Columnas de turno alineadas en el panel por colaborador (unión de códigos del SLA). */
    const bulkPanelShiftColumns = useMemo(() => {
        if (!bulkShowPerEmpPanel) return [] as string[];
        const codes = new Set<string>();
        const addCode = (c: string) => {
            const u = String(c || '').toUpperCase();
            if (u) codes.add(u);
        };
        const shiftsForEmp = (emp: any) => getBulkEmpShifts(emp);
        for (const emp of bulkSelectionEmployees) {
            shiftsForEmp(emp).forEach((s: any) => addCode(s.code));
        }
        if (bulkMonoPerEmpMode) {
            bulkMonoShifts.forEach((s: any) => addCode(s.code));
        }
        addCode('REF');
        addCode('ESC');
        addCode('RET');
        addCode('F');
        const ORDER = ['M', 'T', 'N', 'D12', 'N12', 'RO', 'EN', 'ESC', 'REF', 'RET', 'F'];
        return [...codes].sort((a, b) => {
            const ia = ORDER.indexOf(a);
            const ib = ORDER.indexOf(b);
            if (ia >= 0 && ib >= 0) return ia - ib;
            if (ia >= 0) return -1;
            if (ib >= 0) return 1;
            return a.localeCompare(b);
        });
    }, [
        bulkShowPerEmpPanel, bulkPerEmpMode, bulkMonoPerEmpMode, bulkSelectionEmployees,
        getBulkEmpShifts, bulkMonoShifts,
    ]);

    /** Guardias del panel en el mismo orden que aparecen en el cronograma. */
    const bulkPanelEmployeesSorted = useMemo(() => {
        if (!bulkShowPerEmpPanel || !bulkSelectionEmployees.length) return bulkSelectionEmployees;

        const gridIndex = new Map<string, number>();
        displayedEmployees.forEach((emp: any, i: number) => { if (emp?.id) gridIndex.set(emp.id, i); });

        return [...bulkSelectionEmployees].sort((a, b) => {
            const giA = gridIndex.get(a.id) ?? 9999;
            const giB = gridIndex.get(b.id) ?? 9999;
            return giA - giB;
        });
    }, [bulkShowPerEmpPanel, bulkSelectionEmployees, displayedEmployees]);

    const objectivePublishLookupKey = useMemo(() => {
        if (!selectedObjective) return '';
        return planificacionPublishLookupKey(
            selectedObjective,
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
        );
    }, [selectedObjective, currentDate]);

    const isCronogramaPublicado = isPlanificacionPublished(publishStatusMap[objectivePublishLookupKey]);

    /** Slots cerrados y fechas pasadas bloqueadas solo con cronograma publicado (salvo modo corrección). */
    const enforcePlanningClosureRules = isCronogramaPublicado && !correctionMode;

    /** Multiselección / barra masiva: borrador siempre; publicado solo en modo corrección. */
    const allowPlanningMultiSelect = !isCronogramaPublicado || correctionMode;

    useEffect(() => {
        if (allowPlanningMultiSelect) return;
        setSelection((prev) => {
            if (!prev.start || !prev.end) return prev;
            if (prev.start.r === prev.end.r && prev.start.c === prev.end.c) return prev;
            return { start: null, end: null };
        });
        setIsDragging(false);
        setColumnSelectMode(false);
        setColumnSelectSource(null);
    }, [allowPlanningMultiSelect]);

    const isPlanningDateLocked = useCallback(
        (dateStr: string) => (enforcePlanningClosureRules ? isDateLocked(dateStr) : false),
        [enforcePlanningClosureRules],
    );

    // Bloqueo por puesto/día: mono-pax 24hs no mezcla 8h con 12h; multi-pax permite un esquema por unidad; cap por código.
    const shiftButtonDisabledMap = useMemo(() => {
        const disabled = new Set<string>();
        if (!selectedCell?.dateStr || !selectedObjective || !uniqueSLAShifts.length) return disabled;
        const dateStr = selectedCell.dateStr;
        const posName = activePosition || (effectivePosStructure[0]?.positionName) || 'General';
        // RET y francos nunca se bloquean por días; solo los turnos laborales reales
        const isWorking = (code: string) => !['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET'].includes(String(code || '').toUpperCase());

        // PAX del puesto actual
        const posConfig = effectivePosStructure.find((p: any) => p.positionName === posName) || effectivePosStructure[0];
        const pax = Math.max(1, Number(posConfig?.qty) || 1);

        const dayLetter = getDayLetter(dateStr);

        // Si el puesto no está activo hoy → bloquear todos los turnos laborales
        if (!isPosActiveOnDay(posConfig, dayLetter, dateStr)) {
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (isWorking(code)) disabled.add(code);
            });
            return disabled;
        }

        // Día excluido por SLA (Servicios → días excluidos): sin turnos laborales en este puesto
        if (isPosExcludedOnDate(posConfig, dateStr)) {
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (isPlanningWorkShiftCode(code)) disabled.add(code);
            });
            disabled.add('RET');
            disabled.add('REF');
            disabled.add('ESC');
            return disabled;
        }

        // Cobertura de dotacion: filtrar codigos permitidos para este empleado en este puesto
        if (activeSlaPositionAssignments?.length && selectedCell?.empId) {
            const empAssignment = activeSlaPositionAssignments.find((a) => a.employeeId === selectedCell.empId);
            if (empAssignment) {
                const posSlot = empAssignment.slots?.find((s) => s.positionName === posName);
                if (!posSlot) {
                    uniqueSLAShifts.forEach((s) => {
                        const code = String(s.code || '').toUpperCase();
                        if (isWorking(code)) disabled.add(code);
                    });
                    return disabled;
                }
                if (posSlot.shiftCodes?.length > 0) {
                    uniqueSLAShifts.forEach((s) => {
                        const code = String(s.code || '').toUpperCase();
                        if (isWorking(code) && !posSlot.shiftCodes.includes(code)) disabled.add(code);
                    });
                }
            }
        }

        // Condiciones: bloquear codigos por reglas RESTRICT que disparan en este dia
        if (activeSlaServiceRules?.length && selectedCell?.empId) {
            for (const rule of activeSlaServiceRules) {
                if (!rule.triggers.length) continue;
                const fires = rule.triggers.every(t => {
                    const k = `${t.employeeId}_${dateStr}`;
                    const a = pendingChanges[k] ?? shiftsMap[k];
                    return a && !a.isDeleted && String(a.code || a.type || '').toUpperCase() === String(t.shiftCode || '').toUpperCase();
                });
                if (!fires) continue;
                for (const action of rule.actions) {
                    if (action.type === 'RESTRICT' && action.employeeId === selectedCell.empId && action.allowedCode) {
                        uniqueSLAShifts.forEach((s: any) => {
                            const code = String(s.code || '').toUpperCase();
                            if (isWorking(code) && code !== String(action.allowedCode || '').toUpperCase()) disabled.add(code);
                        });
                    }
                }
            }
        }

        // Shift-level: bloquear cada turno que tenga days[] o fechas específicas fuera del día actual
        uniqueSLAShifts.forEach((s: any) => {
            const code = String(s.code || '').toUpperCase();
            if (!isWorking(code)) return;
            if (Array.isArray(s.specificDates) && s.specificDates.length > 0) {
                if (!s.specificDates.includes(dateStr)) disabled.add(code);
                return;
            }
            if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(dayLetter)) {
                disabled.add(code);
            }
        });
        // Si todos los turnos laborales quedaron bloqueados, retornar early
        const workingInSLA = uniqueSLAShifts.filter((s: any) => isWorking(String(s.code || '').toUpperCase()));
        if (workingInSLA.length > 0 && workingInSLA.every((s: any) => disabled.has(String(s.code || '').toUpperCase()))) {
            return disabled;
        }

        // Fallback de positionName igual que calculateCoverageStats
        const dominant = effectivePosStructure.reduce((prev: any, curr: any) => ((prev?.qty || 0) >= (curr?.qty || 0) ? prev : curr), effectivePosStructure[0]);

        const assigned: { code: string; hours: number }[] = [];
        const posShiftsForBand = (posConfig?.shifts || uniqueSLAShifts || []) as any[];
        const covObjIdForDisable = (selectedGrupo && grupoUnifiedMode && cellPlanningObjectiveId)
            ? cellPlanningObjectiveId
            : selectedObjective;
        const _empsForDisabled = displayedEmployees;
        _empsForDisabled.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (!shift) return;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (shiftPos !== posName) return;
            if (!isWorking(shift.code)) return;
            // Cupo por objetivo: un M en Ville no cierra el M de María (ni ningún otro del grupo).
            const effectiveObjId = resolveEffectiveShiftObjectiveId(emp, shift, key);
            if (String(effectiveObjId || '') !== String(covObjIdForDisable)) return;
            const code = String(shift.code || shift.type || '').toUpperCase();
            const hours = resolveBandHours(code, shift, posShiftsForBand);
            assigned.push({ code, hours });
        });

        const is24hPos = is24hCoverageType(posConfig);

        // Custom: turnos con nombre libre — solo cupo por código (hasta pax) y cierre de esquema.
        // No aplicar mezcla 8h/12h (eso es de puestos 24hs M+T+N vs D12+N12).
        if (!is24hPos) {
            const codeCounts: Record<string, number> = {};
            assigned.forEach(a => { codeCounts[a.code] = (codeCounts[a.code] || 0) + 1; });
            const units = countPositionClosedUnitsFromShifts(
                posConfig,
                dayLetter,
                codeCounts,
                autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles,
                true,
                dateStr,
            );
            const schemeFull = units.required > 0 && units.closed >= units.required;
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (!isWorking(code)) return;
                if (schemeFull) { disabled.add(code); return; }
                // Per-shift PAX: usar quantity del turno específico cuando está definido
                const shiftCfg = (posConfig?.shifts as any[])?.find((sh: any) => String(sh.code || '').toUpperCase() === code);
                const shiftPax = shiftCfg?.quantity != null ? Math.max(1, Number(shiftCfg.quantity)) : pax;
                if ((codeCounts[code] || 0) >= shiftPax) disabled.add(code);
            });
            return disabled;
        }

        const shifts8h = uniqueSLAShifts.filter((s: any) => isShortBandHours(resolveBandHours(s.code, s, posShiftsForBand)));
        const shifts12h = uniqueSLAShifts.filter((s: any) => !isShortBandHours(resolveBandHours(s.code, s, posShiftsForBand)));
        // 24hs: M+T+N (8h) o D12+N12 (12h); cada código hasta pax
        const max8hSlots = shifts8h.length * pax;
        const max12hSlots = shifts12h.length * pax;

        uniqueSLAShifts.forEach((s: any) => {
            const code = String(s.code || '').toUpperCase();
            const hours = resolveBandHours(code, s, posShiftsForBand);

            if (is24hsSinglePaxBandMixBlocked(pax, code, assigned, hours)) {
                disabled.add(code);
                return;
            }
            if (pax > 1) {
                const codeCount = assigned.filter(a => a.code === code).length;
                if (codeCount >= pax) { disabled.add(code); return; }
                if (assigned.length >= max8hSlots + max12hSlots) { disabled.add(code); return; }
            }
        });
        return disabled;
    }, [selectedCell?.dateStr, selectedCell?.empId, selectedObjective, activePosition, effectivePosStructure, positionStructure, displayedEmployees, pendingChanges, shiftsMap, uniqueSLAShifts, autoCycles, selectedGrupo, grupoUnifiedMode, slaIdToObjId, cellPlanningObjectiveId, resolveEffectiveShiftObjectiveId, activeSlaPositionAssignments, activeSlaServiceRules]);

    // 🛑 RESTAURADO: swapCandidates
    const swapCandidates = useMemo(() => { 
        if (!showSwapModal) return []; 
        return employees.filter(e => e.id !== swapConfig?.empId)
                        .filter(e => matchesEmployeeSearch(e, swapSearchTerm))
                        .sort((a, b) => a.name.localeCompare(b.name)); 
    }, [employees, showSwapModal, swapSearchTerm, swapConfig]);

    // 🛑 RESTAURADO + FIX: targetFrancos (solo fechas válidas para enroque)
    useEffect(() => {
        if (!selectedSwapTarget || !selectedCell?.empId || !selectedCell?.dateStr) {
            setTargetFrancos([]);
            return;
        }

        const getShiftInfo = (empId: string, dateStr: string) => {
            const k = `${empId}_${dateStr}`;
            const pending = pendingChanges[k];
            if (pending) return pending.isDeleted ? null : pending;
            return shiftsMap[k] || null;
        };

        const isWorkingCode = (code: string) => !PLANNING_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());

        const dates: any[] = [];
        const seen = new Set<string>();

        // Regla: solo ofrecer francos del target (emp2) donde emp1 NO tenga turno asignado
        Object.values(shiftsMap).forEach((s: any) => {
            if (s.employeeId !== selectedSwapTarget) return;
            const isTargetFranco = (s.code === 'F' || s.isFranco) && !s.isFrancoTrabajado;
            if (!isTargetFranco) return;

            const dateStr = getDateKey(s.startTime);
            if (seen.has(dateStr)) return;
            if (isPlanningDateLocked(dateStr)) return;

            // Si emp1 ya trabaja en dateStr, no es válida (evita doble turno / transferencias)
            const emp1Shift = getShiftInfo(selectedCell.empId, dateStr);
            if (emp1Shift && isWorkingCode(emp1Shift.code)) return;

            // Si emp2 ya trabaja en date1 en OTRO objetivo, evitamos ofrecer (enroque no debe mover turnos cross-objetivo)
            const emp2ShiftAtDate1 = getShiftInfo(selectedSwapTarget, selectedCell.dateStr);
            if (emp2ShiftAtDate1 && isWorkingCode(emp2ShiftAtDate1.code) && emp2ShiftAtDate1.objectiveId && emp2ShiftAtDate1.objectiveId !== selectedObjective) return;

            const [, m, d] = dateStr.split('-');
            seen.add(dateStr);
            dates.push({ dateStr, label: `${d}/${m}` });
        });

        setTargetFrancos(dates.sort((a, b) => a.dateStr.localeCompare(b.dateStr)));
    }, [selectedSwapTarget, shiftsMap, pendingChanges, selectedCell?.empId, selectedCell?.dateStr, selectedObjective, isPlanningDateLocked]);

    const activeServiceStatus = useMemo(() => {
        if (!selectedClient || !selectedObjective) return { status: 'IDLE', msg: '', icon: null };
        const catalogReady = !loadingEmpresa && (clients.length > 0 || !isDataSyncing);
        if (!catalogReady) return { status: 'IDLE', msg: '', icon: null };
        const client = clients.find(c => c.id === selectedClient);
        if (!client) return { status: 'DELETED', msg: 'CLIENTE NO ENCONTRADO', icon: <Ghost size={20}/> };
        
        const obj = client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) ||
                    client.objetivos?.find((o: any) => o.name === getObjectiveName(selectedObjective));
        
        if (!obj) return { status: 'DELETED', msg: '⚠️ OBJETIVO ELIMINADO / NO EXISTE', icon: <Ghost size={20}/> };
        if (obj.status === 'INACTIVE' || obj.active === false) return { status: 'INACTIVE', msg: '⛔ SERVICIO SUSPENDIDO / INACTIVO', icon: <PowerOff size={20}/> };
        if (!hasActiveSLA) {
            const hint = slaPlanningHint ? ` (${slaPlanningHint})` : '';
            return { status: 'DELETED', msg: `⛔ SIN SERVICIO ACTIVO PARA ESTE MES — No se puede planificar${hint}`, icon: <Database size={20}/> };
        }
        
        if (obj.endDate) {
            const [y, m, d] = obj.endDate.includes('-') ? obj.endDate.split('-').map(Number) : [0,0,0];
            if (y > 0) {
                const end = new Date(y, m - 1, d);
                end.setHours(23, 59, 59, 999); 
                const viewStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                if (viewStart > end) return { status: 'EXPIRED', msg: `⛔ CONTRATO FINALIZADO EL ${obj.endDate}`, icon: <LockKeyhole size={20}/> };
            }
        }
        return { status: 'ACTIVE', msg: 'OK', icon: <CheckCircle size={20}/> };
    }, [selectedClient, selectedObjective, clients, currentDate, hasActiveSLA, slaPlanningHint, loadingEmpresa, isDataSyncing]);

    const isServiceLocked = activeServiceStatus.status !== 'ACTIVE' && activeServiceStatus.status !== 'IDLE';

    const catalogReady = !loadingEmpresa && (clients.length > 0 || !isDataSyncing);
    const planningBusyLabel = !catalogReady
        ? 'Cargando…'
        : (selectedObjective && !shiftsMapLoaded ? 'Cargando turnos…' : null);

    // ============================================================================
    // 5. MOTORES DE CÁLCULO (NIVEL 4 - SLA INTELLIGENCE V9.00)
    // ============================================================================

    const calculateCoverageStats = (
        dateStr: string,
        positionName: string,
        structure: any[],
        employeesList: any[],
        changes: any,
        existing: any,
        objectiveId?: string | null,
    ) => {
        const covObjId = objectiveId ?? selectedObjective;
        const posConfig = structure.find((p: any) => p.positionName === positionName) || structure[0] || { qty: 1, shifts: [], coverageType: '24hs' };
        const pax = Number(posConfig.qty) > 0 ? Number(posConfig.qty) : 1;
        const coverageType = posConfig.coverageType || 'custom';
        const dayLetter = getDayLetter(dateStr);
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;

        const isDayActive = isPosActiveOnDay(posConfig, dayLetter, dateStr);
        const isDayExcluded = isPosExcludedOnDate(posConfig, dateStr);
        const target = isDayActive && !isDayExcluded
            ? dailyCoverageHoursTargetWithPerShiftPax(posConfig, pax, dayLetter, cycles, dateStr)
            : 0;

        // Bandas del puesto (SLA), no las del ciclo automático: si no, M+T+N da 0h/72h con 3/3.
        const validWorkCodes = new Set(
            (posConfig.shifts || [])
                .map((s: any) => String(s.code || '').toUpperCase())
                .filter((c: string) => c && isPlanningWorkShiftCode(c)),
        );

        let current = 0;
        const dominant = structure.reduce((prev: any, current: any) => (prev.qty > current.qty) ? prev : current, structure[0] || { qty: 1, positionName: 'General' });

        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const absence = absencesMap[key];
            if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || existing[key]?.code, absence })) return;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (!shift) return;
            const pending = changes[key];
            const explicitObj = pending?.objectiveId ?? shift.objectiveId;
            const effectiveObjId = explicitObj
                ? String(explicitObj)
                : (resolveNativeObjectiveInGrupo(emp) || (emp.preferredObjectiveId === covObjId || slaIdToObjId[emp.preferredObjectiveId] === covObjId ? covObjId : null));
            if (String(effectiveObjId || '') !== String(covObjId)) return;
            const code = String(shift.code || '').toUpperCase();
            if (PLANNING_NON_BILLABLE_CODES.has(code)) return;
            const homePos = shift.positionName || dominant?.positionName || 'General';
            const attributed = calcPlanningBillableHoursAttributedToPosition(
                { ...shift, positionName: homePos },
                positionName,
                slaCodeHoursHint,
            );
            if (attributed <= 0) return;
            const isHomePos = String(homePos) === String(positionName);
            if (isHomePos && validWorkCodes.size > 0 && isPlanningWorkShiftCode(code) && !validWorkCodes.has(code)) return;
            current += attributed;
        });
        return { current, target, pax, isActiveDay: isDayActive && !isDayExcluded, isExcludedDay: isDayExcluded };
    };

    /**
     * Puestos cerrados por día: 1 pax = esquema SLA completo del puesto.
     * 24hs: M+T+N (24h) o D12+N12 (24h); custom: todas las bandas del turno (ej. M+T = 16h).
     */
    const countPositionClosedUnits = (
        dateStr: string,
        pos: any,
        dayLetter: string,
        employeesList: any[],
        changes: any,
        existing: any,
        cycles?: string[],
        objectiveId?: string | null,
        structureForDominant?: any[],
    ): { closed: number; required: number; schemeLabel: string } => {
        const covObjId = objectiveId ?? selectedObjective;
        if (!isPosActiveOnDay(pos, dayLetter, dateStr)) return { closed: 0, required: 0, schemeLabel: '' };
        if (isPosExcludedOnDate(pos, dateStr)) return { closed: 0, required: 0, schemeLabel: 'EXCL' };

        const structDom = structureForDominant?.length ? structureForDominant : (positionStructure || []);
        const dominant = structDom.reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            structDom[0] || { qty: 1, positionName: 'General' },
        );
        const codeCounts: Record<string, number> = {};
        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const absence = absencesMap[key];
            if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || existing[key]?.code, absence })) return;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (!shift) return;
            const pending = changes[key];
            const explicitObj = pending?.objectiveId ?? shift.objectiveId;
            const effectiveObjId = explicitObj
                ? String(explicitObj)
                : (resolveNativeObjectiveInGrupo(emp) || (emp.preferredObjectiveId === covObjId || slaIdToObjId[emp.preferredObjectiveId] === covObjId ? covObjId : null));
            if (String(effectiveObjId || '') !== String(covObjId)) return;
            const code = String(shift.code || '').toUpperCase();
            if (PLANNING_NON_BILLABLE_CODES.has(code)) return;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (shiftPos !== pos.positionName) return;
            codeCounts[code] = (codeCounts[code] || 0) + 1;
        });

        const splitCredits = collectSplitBandCreditsForDay(
            employeesList,
            dateStr,
            (empId, ds) => {
                const k = `${empId}_${ds}`;
                const pending = changes[k];
                if (pending?.isDeleted) return null;
                return pending ? pending : existing[k] || null;
            },
            {
                selectedObjective: covObjId,
                isPendingChange: (empId, ds) => !!changes[`${empId}_${ds}`],
                resolveOriginalShift: (empId, ds) => existing[`${empId}_${ds}`] || null,
                shiftsMap: existing,
                pendingChanges: changes,
            },
        );
        const posCredits = lookupSplitCreditsForPosition(splitCredits, pos.positionName);
        for (const [bandCode, n] of Object.entries(posCredits)) {
            codeCounts[bandCode] = (codeCounts[bandCode] || 0) + n;
        }

        return countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cycles, true, dateStr);
    };

    // 🛑 MEMOIZACIÓN CRÍTICA PARA EL MODAL
    const modalCoverageStats = useMemo(() => {
        if (!selectedCell || !selectedObjective) return null;
        const covObjId = (selectedGrupo && grupoUnifiedMode && cellPlanningObjectiveId)
            ? cellPlanningObjectiveId
            : selectedObjective;
        const currentPosName = activePosition || selectedCell.currentShift?.positionName || (effectivePosStructure.length > 0 ? effectivePosStructure[0].positionName : 'General');
        const dateStr = selectedCell.dateStr;
        const dayLetter = getDayLetter(dateStr);
        // Grupo unificado: todos los visibles en grilla; el filtro por objetivo va en covObjId al contar turnos
        const _empsForModal = displayedEmployees;
        const hoursStats = calculateCoverageStats(dateStr, currentPosName, effectivePosStructure, _empsForModal, pendingChanges, shiftsMap, covObjId);
        const posConfig = effectivePosStructure.find((p: any) => p.positionName === currentPosName) || effectivePosStructure[0];
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;
        const units = posConfig
            ? countPositionClosedUnits(dateStr, posConfig, dayLetter, _empsForModal, pendingChanges, shiftsMap, cycles, covObjId, effectivePosStructure)
            : { closed: 0, required: 0, schemeLabel: '' };
        return {
            ...hoursStats,
            closedUnits: units.closed,
            requiredUnits: units.required,
            schemeLabel: units.schemeLabel,
            isPositionClosed: units.required > 0 && units.closed >= units.required,
            isExcludedDay: hoursStats.isExcludedDay,
        };
    }, [selectedCell, activePosition, displayedEmployees, pendingChanges, shiftsMap, effectivePosStructure, positionStructure, selectedObjective, autoCycles, selectedGrupo, grupoUnifiedMode, slaIdToObjId, cellPlanningObjectiveId]);

    const coverageCyclesForObjective = autoSelectedCyclesRef.current?.length
        ? autoSelectedCyclesRef.current
        : autoCycles;

    const buildDayCodeCountsByPosition = (dateStr: string) => buildCodeCountsByPositionForDay(
        positionStructure || [],
        dateStr,
        dotacionBaseEmployees,
        (empId, ds) => {
            const key = `${empId}_${ds}`;
            const pending = pendingChanges[key];
            if (pending?.isDeleted) return { isDeleted: true };
            const raw = pending ? pending : shiftsMap[key];
            if (!raw) return null;
            // Normalizar slaId→objId para que shiftBelongsToObjective matchee correctamente
            const rawObjId = raw.objectiveId;
            if (rawObjId && slaIdToObjId[rawObjId] && rawObjId !== slaIdToObjId[rawObjId]) {
                return { ...raw, objectiveId: slaIdToObjId[rawObjId] };
            }
            return raw;
        },
        {
            selectedObjective,
            dominantPositionName: dominantPosition?.positionName || 'General',
            isPendingChange: (empId, ds) => !!pendingChanges[`${empId}_${ds}`],
            existingShiftsMap: shiftsMap,
            pendingChangesMap: pendingChanges,
        },
    );

    const objectiveCoverageGapReport = useMemo(() => {
        if (!selectedObjective || !(positionStructure?.length)) return null;
        const days = daysInMonth.map(day => {
            const dateStr = getDateKey(day);
            return { dateStr, dayLetter: getDayLetter(dateStr) };
        });
        const codeCountsByDay: Record<string, Record<string, Record<string, number>>> = {};
        for (const { dateStr } of days) {
            codeCountsByDay[dateStr] = buildDayCodeCountsByPosition(dateStr);
        }
        return analyzeObjectiveCoverageGaps(
            positionStructure,
            days,
            codeCountsByDay,
            coverageCyclesForObjective,
            isPosActiveOnDay,
        );
    }, [selectedObjective, positionStructure, daysInMonth, dotacionBaseEmployees, pendingChanges, shiftsMap, coverageCyclesForObjective, dominantPosition]);

    /**
     * Cobertura de un objetivo dentro del grupo unificado.
     * Debe incluir créditos Ext+Adel (igual que countPositionClosedUnits en vista individual);
     * sin eso, días cerrados por split aparecen como hueco al sumar el grupo (ej. 1/2 con ambos cronos en 1/1).
     */
    const sumGrupoObjectiveCoverageForDay = useCallback((
        objId: string,
        dateStr: string,
        dayLetter: string,
        cycles?: string[],
    ): { required: number; closed: number } => {
        const structure = grupoSlaMap[objId] || [];
        if (!structure.length) return { required: 0, closed: 0 };
        const dominant = structure.reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            structure[0] || { qty: 1, positionName: 'General' },
        );
        const codeCountsByPos: Record<string, Record<string, number>> = {};
        for (const pos of structure) {
            codeCountsByPos[String(pos.positionName || 'General')] = {};
        }

        const empById = new Map<string, any>(dotacionBaseEmployees.map((e: any) => [e.id, e]));

        for (const emp of dotacionBaseEmployees) {
            const key = `${emp.id}_${dateStr}`;
            const absence = absencesMap[key];
            if (isEmployeeOnLeave({ shiftCode: pendingChanges[key]?.code || shiftsMap[key]?.code, absence })) continue;
            const shift = pendingChanges[key]
                ? (pendingChanges[key].isDeleted ? null : pendingChanges[key])
                : shiftsMap[key];
            if (!shift) continue;
            const effectiveObjId = resolveEffectiveShiftObjectiveId(emp, shift, key);
            if (String(effectiveObjId || '') !== String(objId)) continue;
            const code = String(shift.code || '').toUpperCase();
            if (PLANNING_NON_BILLABLE_CODES.has(code)) continue;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (!codeCountsByPos[shiftPos]) codeCountsByPos[shiftPos] = {};
            codeCountsByPos[shiftPos][code] = (codeCountsByPos[shiftPos][code] || 0) + 1;
        }

        const splitCredits = collectSplitBandCreditsForDay(
            dotacionBaseEmployees,
            dateStr,
            (empId, ds) => {
                const emp = empById.get(empId) || { id: empId };
                const key = `${empId}_${ds}`;
                const pending = pendingChanges[key];
                if (pending?.isDeleted) return null;
                const raw = pending || shiftsMap[key] || null;
                if (!raw) return null;
                const effectiveObjId = resolveEffectiveShiftObjectiveId(emp, raw, key);
                if (String(effectiveObjId || '') !== String(objId)) return null;
                // Forzar objectiveId del objetivo para que shiftBelongsToObjective no confunda con slaId / pending huérfano.
                return { ...raw, objectiveId: objId };
            },
            {
                selectedObjective: objId,
                isPendingChange: (empId, ds) => !!pendingChanges[`${empId}_${ds}`],
                resolveOriginalShift: (empId, ds) => shiftsMap[`${empId}_${ds}`] || null,
                shiftsMap,
                pendingChanges,
            },
        );

        let required = 0;
        let closed = 0;
        for (const pos of structure) {
            if (!isPosActiveOnDay(pos, dayLetter, dateStr)) continue;
            if (isPosExcludedOnDate(pos, dateStr)) continue;
            const posName = String(pos.positionName || 'General');
            const codeCounts: Record<string, number> = { ...(codeCountsByPos[posName] || {}) };
            const posCredits = lookupSplitCreditsForPosition(splitCredits, posName);
            for (const [bandCode, n] of Object.entries(posCredits)) {
                codeCounts[bandCode] = (codeCounts[bandCode] || 0) + n;
            }
            const units = countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cycles, true, dateStr);
            required += units.required;
            closed += units.closed;
        }
        return { required, closed };
    }, [grupoSlaMap, dotacionBaseEmployees, pendingChanges, shiftsMap, absencesMap, resolveEffectiveShiftObjectiveId]);

    // Diagnóstico de cobertura agregado para la vista de grupo unificado
    const grupoGapReport = useMemo(() => {
        if (!selectedGrupo || !grupoUnifiedMode || Object.keys(grupoSlaMap).length === 0) return null;
        let daysFull = 0, daysPartial = 0, daysEmpty = 0;
        const worstDays: { dateStr: string; closedPax: number; requiredPax: number }[] = [];
        for (const day of daysInMonth) {
            const dateStr = getDateKey(day);
            const dayLetter = getDayLetter(dateStr);
            let requiredPax = 0, closedPax = 0;
            for (const objId of selectedGrupo.objectiveIds) {
                const units = sumGrupoObjectiveCoverageForDay(objId, dateStr, dayLetter, undefined);
                requiredPax += units.required;
                closedPax += units.closed;
            }
            if (requiredPax === 0) continue;
            if (closedPax >= requiredPax) { daysFull++; }
            else if (closedPax > 0) { daysPartial++; worstDays.push({ dateStr, closedPax, requiredPax }); }
            else { daysEmpty++; worstDays.push({ dateStr, closedPax, requiredPax }); }
        }
        return { daysFull, daysPartial, daysEmpty, worstDays };
    }, [selectedGrupo, grupoUnifiedMode, grupoSlaMap, daysInMonth, sumGrupoObjectiveCoverageForDay]);

    const buildDayCoverageReport = (dateStr: string) => {
        const structure = effectivePosStructure.length > 0 ? effectivePosStructure : positionStructure;
        if (!structure?.length) return null;
        const dayLetter = getDayLetter(dateStr);
        const codeCounts = buildDayCodeCountsByPosition(dateStr);
        return analyzeDayCoverageGaps(
            structure,
            dateStr,
            dayLetter,
            codeCounts,
            coverageCyclesForObjective,
            isPosActiveOnDay,
        );
    };

    const resolveSuggestedGapBandForPosition = (dateStr: string, positionName: string): string | undefined => {
        const dayReport = buildDayCoverageReport(dateStr);
        if (!dayReport) return undefined;
        const gapRows = flattenDayGapsForUi(dayReport);
        const gapRow = gapRows.find((g) => g.positionName === positionName)
            || gapRows.find((g) => g.gapBand);
        if (gapRow?.gapBand) return gapRow.gapBand;
        const code = gapRow?.code;
        if (code && !code.includes(' o ')) return code;
        return undefined;
    };

    const resolveSuggestedGapPositionForDay = (dateStr: string, fallback: string): string => {
        const dayReport = buildDayCoverageReport(dateStr);
        if (!dayReport) return fallback;
        const gapRows = flattenDayGapsForUi(dayReport);
        const active = String(activePosition || '').trim();
        if (active && active !== 'General' && active !== 'Retén') {
            if (gapRows.some((g) => g.positionName === active) || dayReport.positions.some((p) => p.positionName === active && p.missingUnits > 0)) {
                return active;
            }
        }
        const firstOpen = dayReport.positions.find((p) => p.missingUnits > 0);
        if (firstOpen?.positionName) return firstOpen.positionName;
        const fromGap = gapRows.find((g) => g.positionName)?.positionName;
        return fromGap || fallback;
    };

    const renderDayCoverageClosures = (dateStr: string, opts?: { compact?: boolean }) => {
        const dayReport = buildDayCoverageReport(dateStr);
        if (!dayReport || dayReport.required === 0) return null;
        const isFull = dayReport.isFull;
        const openPositions = dayReport.positions.filter(p => p.missingUnits > 0);
        return (
            <div className={`rounded-xl border-2 mb-4 ${isFull ? 'border-emerald-200 bg-emerald-50/90' : 'border-rose-300 bg-rose-50/90'} ${opts?.compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className={`text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 ${isFull ? 'text-emerald-800' : 'text-rose-800'}`}>
                        <ShieldCheck size={12}/>
                        Cierres de cobertura · día {dateStr.slice(8, 10)}
                    </p>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-lg ${isFull ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}`}>
                        {dayReport.closed}/{dayReport.required} pax
                    </span>
                </div>
                {isFull ? (
                    <p className="text-[10px] font-bold text-emerald-700">Esquema SLA completo en todos los puestos activos.</p>
                ) : (
                    <div className="space-y-1">
                        {openPositions.map(pg => (
                            <div key={pg.positionName} className="text-[10px] font-bold text-rose-800 leading-snug">
                                <span className="font-black">{pg.positionName}</span>
                                {pg.summary && !pg.summary.includes(';') ? (
                                    <span className="text-rose-600"> — {pg.summary}</span>
                                ) : (
                                    <>
                                        <span className="text-rose-600"> — faltan {pg.missingUnits} pax</span>
                                        {pg.schemeLabel && <span className="text-rose-500 font-medium"> ({pg.schemeLabel})</span>}
                                        {pg.summary && <p className="text-[9px] text-rose-600/90 font-medium mt-0.5">{pg.summary}</p>}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const getPositionDailyCoverage = (dateStr: string, positionName: string) => {
        return calculateCoverageStats(dateStr, positionName, positionStructure, displayedEmployees, pendingChanges, shiftsMap);
    };

    // Sincronización Reactiva del Modal
    useEffect(() => {
        if (selectedCell?.currentShift?.objectiveId && selectedGrupo?.objectiveIds.includes(String(selectedCell.currentShift.objectiveId))) {
            setCellTargetObjectiveId(String(selectedCell.currentShift.objectiveId));
        } else {
            setCellTargetObjectiveId(null);
        }
        if (selectedCell) {
            const planObj = selectedGrupo && grupoUnifiedMode
                ? (cellTargetObjectiveId || selectedCell.currentShift?.objectiveId || selectedObjective)
                : selectedObjective;
            const struct = (selectedGrupo && grupoUnifiedMode && planObj && grupoSlaMap[planObj])
                ? grupoSlaMap[planObj]
                : positionStructure;
            const empPreferred = empDefaultPos[`${selectedCell.empId}___${planObj}`] || empDefaultPos[`${selectedCell.empId}___${selectedObjective}`];
            const smartDefault = selectedCell.currentShift?.positionName || empPreferred || struct[0]?.positionName || dominantPosition.positionName || 'General';
            // Si no hay turno asignado y hay exactamente un puesto con faltante, pre-seleccionarlo
            if (!selectedCell.currentShift) {
                const dayReport = buildDayCoverageReport(selectedCell.dateStr);
                const openPositions = dayReport ? dayReport.positions.filter((p: any) => p.missingUnits > 0) : [];
                if (openPositions.length === 1) {
                    setActivePosition(openPositions[0].positionName);
                    return;
                }
            }
            const validNames = new Set((struct || []).map((p: any) => p.positionName));
            setActivePosition(validNames.has(smartDefault) ? smartDefault : (struct[0]?.positionName || smartDefault));
        } else {
            setActivePosition(null);
        }
    }, [selectedCell, dominantPosition, empDefaultPos, selectedObjective, selectedGrupo, grupoUnifiedMode, grupoSlaMap, positionStructure]);

    // Al cambiar objetivo destino en el modal de grupo: recargar puesto/turnos del SLA correcto
    useEffect(() => {
        if (!selectedCell || !selectedGrupo || !grupoUnifiedMode || !cellPlanningObjectiveId) return;
        const struct = grupoSlaMap[cellPlanningObjectiveId] || [];
        if (!struct.length) return;
        const names = new Set(struct.map((p: any) => p.positionName));
        setActivePosition(prev => (prev && names.has(prev) ? prev : struct[0].positionName));
    }, [cellPlanningObjectiveId, selectedCell, selectedGrupo, grupoUnifiedMode, grupoSlaMap]);

    const getPositionHoursCoverage = (dateStr: string) => {
        const coverage: Record<string, { coveredHours: number, count: number }> = {};
        if (!selectedObjective) return coverage;
        displayedEmployees.forEach(emp => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (!shift) return;
            const effectiveObjId = resolveEffectiveShiftObjectiveId(emp, shift, key);
            if (String(effectiveObjId || '') !== String(selectedObjective)) return;
            if (PLANNING_NON_BILLABLE_CODES.has(String(shift.code || '').toUpperCase())) return;
            const posName = shift.positionName || 'General';
            const hours = calcShiftHours(shift);
            if (!coverage[posName]) coverage[posName] = { coveredHours: 0, count: 0 };
            coverage[posName].coveredHours += hours;
            coverage[posName].count += 1;
        });
        return coverage;
    };

    const checkLaborRules = (
        empId: string,
        targetDate: Date,
        newHours: number,
        proposedShift?: { code: string; startTime?: string; endTime?: string; hours?: number },
    ) => checkPlanificacionLaborRules({
        empId,
        targetDate,
        newHours,
        proposedShift,
        employees,
        absencesMap,
        agreements,
        planningLimits,
        pendingChanges,
        shiftsMap,
    });

    
    const findNeighbors = (problemShift: any, dateStr: string) => {
        setConflictNeighbors(findPlanificacionConflictNeighbors(problemShift, dateStr, shiftsMap, absencesMap, employees));
    };

    const handleContextChange = (newClient: string, newObjective: string) => {
        applyPlanificacionContextChange({
            newClient,
            newObjective,
            pendingChanges,
            setPendingChanges,
            setPendingNovedades,
            clearUndoStack,
            setSelectedGrupo,
            setSelectedClient,
            setSelectedObjective,
            setSearchTerm,
            setShowGuardiaSearch,
            setPinnedExternalEmpIds,
            setBandFilter,
            setForceShowAll,
            setDotacionPoolSearch,
            setSelection,
            setComparingSnapshot,
            setOpenDrop,
            setAutoGeneratedReady,
        });
    };

    const handleGrupoChange = (grupo: GrupoObjetivos | null) => {
        applyPlanificacionGrupoChange({
            grupo,
            pendingChanges,
            setPendingChanges,
            setPendingNovedades,
            setSelectedGrupo,
            setGrupoUnifiedMode,
            setSelectedClient,
            setSelectedObjective,
            setSearchTerm,
            setShowGuardiaSearch,
            setPinnedExternalEmpIds,
            setBandFilter,
            setForceShowAll,
            setDotacionPoolSearch,
            setSelection,
            setComparingSnapshot,
            setOpenDrop,
            setAutoGeneratedReady,
        });
    };

    const openGrupoForm = (mode: 'new' | 'edit', grupo?: GrupoObjetivos) => {
        setGrupoFormMode(mode);
        if (mode === 'edit' && grupo) {
            setGrupoFormEditId(grupo.id || null);
            setGrupoFormNombre(grupo.nombre);
            setGrupoFormClientId(grupo.clientId);
            setGrupoFormObjectiveIds([...grupo.objectiveIds]);
        } else {
            setGrupoFormEditId(null);
            setGrupoFormNombre('');
            setGrupoFormClientId('');
            setGrupoFormObjectiveIds([]);
        }
        setShowGrupoForm(true);
        setOpenDrop(null);
    };

    const handleSaveGrupo = async () =>
        savePlanificacionGrupo({
            grupoFormNombre,
            grupoFormClientId,
            grupoFormObjectiveIds,
            grupoFormMode,
            grupoFormEditId,
            empresaId,
            clients,
            selectedGrupo,
            setSavingGrupo,
            setGrupos,
            setSelectedGrupo,
            setShowGrupoForm,
        });

    // En modo grupo unificado: devuelve el objectiveId correcto para el empleado según su objetivo nativo
    const resolveObjectiveForEmp = useCallback((empId: string): string => {
        if (!selectedGrupo || !grupoUnifiedMode) return selectedObjective;
        const emp = employees.find((e: any) => e.id === empId);
        if (!emp?.preferredObjectiveId) return selectedObjective;
        if (selectedGrupo.objectiveIds.includes(emp.preferredObjectiveId)) return emp.preferredObjectiveId;
        const mapped = slaIdToObjId[emp.preferredObjectiveId];
        if (mapped && selectedGrupo.objectiveIds.includes(mapped)) return mapped;
        return selectedObjective;
    }, [selectedObjective, selectedGrupo, grupoUnifiedMode, employees, slaIdToObjId]);

    const handleDeleteGrupo = async (grupo: GrupoObjetivos) =>
        deletePlanificacionGrupo({
            grupo,
            selectedGrupo,
            setGrupos,
            handleGrupoChange,
        });

    const navigateToObjectiveFromOverview = useCallback((clientId: string, objectiveId: string, year: number, month: number) => {
        if (Object.keys(pendingChanges).length > 0) {
            if (!confirm('⚠️ Tenés cambios sin guardar. ¿Descartar y abrir el objetivo?')) return;
            setPendingChanges({});
            setPendingNovedades({});
        }
        setSelectedClient(clientId);
        setSelectedObjective(objectiveId);
        goToPlanningMonth(year, month - 1);
        setSearchTerm('');
        setShowGuardiaSearch(false);
        setBandFilter(null);
        setForceShowAll(false);
        setDotacionPoolSearch('');
        setSelection({ start: null, end: null });
        setComparingSnapshot(null);
        setOpenDrop(null);
        setAutoGeneratedReady(false);
    }, [goToPlanningMonth]);
    useEffect(() => { if (!openDrop) return; const h = () => setOpenDrop(null); document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, [openDrop]);

    // ============================================================================
    // 6. EFECTOS Y SUBSCRIPCIONES (NIVEL 5)
    // ============================================================================

    const renderLegend = () => {
        const legendGroups = [
            {
                title: 'Turnos de Trabajo',
                items: [
                    { code: 'M',   name: 'Mañana',         sub: '07:00–15:00 · 8h · computa SLA' },
                    { code: 'T',   name: 'Tarde',           sub: '15:00–23:00 · 8h · computa SLA' },
                    { code: 'N',   name: 'Noche',           sub: '23:00–07:00 · 8h · computa SLA' },
                    { code: 'D12', name: 'Diurno 12h',      sub: '07:00–19:00 · 12h · computa SLA' },
                    { code: 'N12', name: 'Nocturno 12h',    sub: '19:00–07:00 · 12h · computa SLA' },
                    { code: 'PU',  name: 'Puesto Único',    sub: 'Horario personalizado' },
                ],
            },
            {
                title: 'Francos / Descansos',
                items: [
                    { code: 'F',  name: 'Franco',               sub: 'Descanso planificado CCT (6+2)' },
                    { code: 'FF', name: 'Franco compensatorio',  sub: 'Devolución de día trabajado' },
                    { code: 'FT', name: 'Franco Trabajado',      sub: 'Cubre ausencia — pago doble CCT' },
                ],
            },
            {
                title: 'Ausencias / Licencias',
                items: [
                    { code: 'V',  name: 'Vacaciones',       sub: 'Período vacacional planificado · pago' },
                    { code: 'L',  name: 'Licencia',         sub: 'Licencia general (art. CCT) · pago' },
                    { code: 'E',  name: 'Enfermedad',       sub: 'Baja médica con certificado · pago' },
                    { code: 'A',  name: 'ART / Autorizada', sub: 'Ausencia autorizada o ART · pago' },
                    { code: 'PG',  name: 'Permiso Gremial',       sub: 'Actividad sindical · pago' },
                    { code: 'SGS', name: 'Sin Goce de Sueldo',   sub: 'Licencia sin remuneración · no computa pago' },
                    { code: 'SUS', name: 'Suspensión',            sub: 'Medida disciplinaria · sin pago · art. 218 LCT' },
                    { code: 'AA',  name: 'Injustificada',         sub: 'Sin justificación ni cert. · sin pago · punto rojo' },
                ],
            },
            {
                title: 'Operativos (no computan SLA)',
                items: [
                    { code: 'RET', name: 'Retén (stand-by)',     sub: 'Disponible para cubrir ausencias' },
                    { code: 'REF', name: 'Refuerzo',             sub: 'Cobertura extra programada · 8h' },
                    { code: 'ESC', name: 'Escuela / formación',  sub: 'Capacitación en puesto · 8h' },
                ],
            },
            {
                title: 'Sistema',
                items: [
                    { code: 'C',            name: 'Consolidado',       sub: 'Turno fichado por el guardia · 8h' },
                    { code: 'LOCKED',       name: 'Bloqueado',         sub: 'Período cerrado o fecha pasada' },
                    { code: 'SWAP',         name: 'Permuta activa',    sub: 'Intercambio de turno confirmado' },
                    { code: 'SWAP_PENDING', name: 'Permuta pendiente', sub: 'Aguarda autorización del supervisor' },
                ],
            },
        ];

        const SectionHeader = ({ title }: { title: string }) => (
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</span>
                <span className="flex-1 h-px bg-slate-100"/>
            </div>
        );

        return (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowLegend(false)}>
                <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl relative border border-slate-100 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl shadow-sm">
                                <Info size={22} strokeWidth={2.5}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800 tracking-tight">Referencias Operativas</h3>
                                <p className="text-slate-400 text-xs">CCT 422/05 — Seguridad Privada</p>
                            </div>
                        </div>
                        <button onClick={() => setShowLegend(false)} className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>

                    <div className="overflow-y-auto custom-scrollbar px-5 py-4 flex flex-col gap-4">
                        {legendGroups.map(group => (
                            <div key={group.title}>
                                <SectionHeader title={group.title}/>
                                <div className="grid grid-cols-2 gap-1">
                                    {group.items.map(item => (
                                        <div key={item.code} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                                            <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-black border shadow-sm ${SHIFT_STYLES[item.code] || 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                                                {item.code === 'SWAP_PENDING' ? 'S!' : item.code}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-slate-700 leading-tight">{item.name}</p>
                                                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.sub}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        <div>
                            <SectionHeader title="Indicadores de Estado"/>
                            <div className="grid grid-cols-2 gap-1">
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm ring-1 ring-slate-100"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Presente</p>
                                        <p className="text-[10px] text-slate-400">Guardia confirmó presencia</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-3 h-3 rounded-full bg-rose-500 border-2 border-white shadow-sm ring-1 ring-slate-100"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Ausente</p>
                                        <p className="text-[10px] text-slate-400">No registró presencia · también en AA</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Conflicto</p>
                                        <p className="text-[10px] text-slate-400">Turnos superpuestos detectados</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-black border ${OTHER_OBJECTIVE_CELL_STYLE}`}>M</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Otro objetivo</p>
                                        <p className="text-[10px] text-slate-400">Turno en objetivo diferente</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-sm font-black text-pink-700 bg-pink-100 border border-pink-200">♀</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Solo femenino</p>
                                        <p className="text-[10px] text-slate-400">Puesto requiere guardia femenina</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-sm font-black text-blue-700 bg-blue-100 border border-blue-200">♂</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Solo masculino</p>
                                        <p className="text-[10px] text-slate-400">Puesto requiere guardia masculino</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    useEffect(() => {
        const loadUsers = async () => { 
            try { 
                const snap = await getDocs(collection(db, 'system_users')); 
                const map: Record<string, string> = {}; 
                snap.docs.forEach(d => { 
                    const u = d.data(); 
                    const displayName = (u.firstName && u.lastName) ? `${u.lastName} ${u.firstName}`.trim() : (u.name || u.email || ''); 
                    if (u.email) map[u.email] = displayName || u.email; 
                    if (d.id) map[d.id] = displayName || u.email || d.id; 
                }); 
                setUsersMap(map); 
            } catch (e) { console.error("Error loading users", e); } 
        };
        loadUsers();
        const auth = getAuth();
        const unsubAuth = onAuthStateChanged(auth, (user) => { if (user) { setOperatorEmail(user.email || ''); setOperatorName(user.displayName || user.email || "Usuario"); } else { setOperatorName("No Logueado"); } });
        return () => unsubAuth();
    }, []);

    // Resetear autorización 200h al cambiar de objetivo o mes
    useEffect(() => {
        setAuthorizedOver200Ids(new Set());
        authorizedOver200IdsRef.current = new Set();
    }, [selectedObjective, currentDate.getFullYear(), currentDate.getMonth()]);

    // Cargar grupos de objetivos
    useEffect(() => {
        if (!empresaId) return;
        gruposService.getByEmpresa(empresaId).then(setGrupos);
    }, [empresaId]);

    usePlanificacionDotacionOverlay({
        employees,
        selectedObjective,
        currentDate,
        empresaId,
        setEmpDefaultPos,
        setEmpDefaultShift,
    });

    usePlanificacionDotacionMigration({ employees });

    // ============================================================================
    // 7. HANDLERS DE USUARIO (NIVEL 6) - DEFINIDOS UNA SOLA VEZ
    // ============================================================================

    // 🛑 V8.20: Handler Restaurado
    const handleNotificationClick = async (notif: any) => {
        setShowNotifications(false);
        // Vacante RFZ sintética (derivada de turnos): abrir directamente el modal de asignación.
        if (typeof notif?.id === 'string' && notif.id.startsWith('rfzvac_') && notif.__rfz) {
            if (notif.clientId) setSelectedClient(notif.clientId);
            if (notif.objectiveId) setSelectedObjective(notif.objectiveId);
            if (typeof notif.fecha === 'string') {
                const [y, m] = notif.fecha.split('-').map(Number);
                if (y && m) setCurrentDate(new Date(y, m - 1, 1));
            }
            setForceShowAll(true);
            activateRfzCorrectionFlow();
            setRfzAsignando(notif.__rfz);
            return;
        }
        if (notif.id) {
            try {
                // Las notificaciones siempre vienen de 'novedades' — nunca de 'ausencias'
                await updateDoc(doc(db, 'novedades', notif.id), { viewed: true, status: 'read' });
                setNotifications(prev => prev.filter(n => n.id !== notif.id));
                setHasUnread(false);
            } catch (e) { console.error("Error update view", e); }
        }

        // Navegar al cliente y objetivo del cronograma
        // Si la notificación no trae objectiveId, lo resolvemos desde el empleado
        const resolvedObjectiveId = notif.objectiveId || (() => {
            const emp = employees.find((e: any) => e.id === notif.employeeId);
            return emp?.preferredObjectiveId || '';
        })();
        const resolvedClientId = notif.clientId || (() => {
            if (!resolvedObjectiveId) return '';
            const c = clients.find((cl: any) => cl.objetivos?.some((o: any) => (o.id || o.name) === resolvedObjectiveId));
            return c?.id || '';
        })();
        const didNavigate = !!(resolvedClientId && resolvedObjectiveId);
        if (didNavigate) {
            setSelectedClient(resolvedClientId);
            setSelectedObjective(resolvedObjectiveId);
            setSearchTerm('');
            setForceShowAll(true);
            const objLabel = getObjectiveName(resolvedObjectiveId) || 'objetivo';
            toast.info(`Navegando a: ${objLabel}`);
        }

        // Refuerzo / agregado solicitado por cliente (portal → planificación)
        const isRefuerzoCliente = notif.type === 'REFUERZO_CLIENTE_PENDIENTE';

        // Vacante generada porque un guardia fue asignado a un evento
        const isVacantePorEvento = notif.type === 'VACANTE_POR_EVENTO';

        // Ausencias que requieren gestión de cobertura
        const isVacancyAbsence = !isRefuerzoCliente && !isVacantePorEvento && notif.type &&
            (notif.type === 'Vacaciones' || notif.type.includes('Licencia') || notif.type === 'PG Permiso Gremial');

        const rawFechaRefuerzo = (isRefuerzoCliente || isVacantePorEvento) ? (notif.fecha || notif.date) : null;

        if (rawFechaRefuerzo || notif.date || notif.startDate) {
            try {
                let targetDate: Date | null = null;
                const rawDate = rawFechaRefuerzo || notif.date || notif.startDate;

                if (typeof rawDate === 'string') {
                    const parts = rawDate.split('-');
                    if(parts.length === 3) targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else if (rawDate?.seconds) {
                    targetDate = new Date(rawDate.seconds * 1000);
                }

                if (targetDate) {
                    // Navegar al mes correcto SIEMPRE (antes de abrir cualquier modal)
                    setCurrentDate(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));

                    if (isRefuerzoCliente) {
                        const instruccion = notif.description || notif.msg
                            || `Asigná ${notif.tipoSolicitud === 'TURA' ? 'TURA' : 'REF/RFZ'} en el cronograma para el ${targetDate.toLocaleDateString('es-AR')}.`;
                        toast.info(instruccion, { duration: 9000 });
                        return;
                    }

                    if (isVacantePorEvento) {
                        const msg = notif.description || notif.msg
                            || `${notif.employeeName || 'Guardia'} sale al evento. Cubrí el turno ${notif.codigoTurnoOriginal || ''} en ${notif.objectiveName || 'el objetivo'} para el ${targetDate.toLocaleDateString('es-AR')}.`;
                        toast.info(msg, { duration: 9000 });
                        return;
                    }

                    const targetEmp = employees.find(e => e.id === notif.employeeId || e.name === notif.employeeName);

                    if (targetEmp) {
                        setSearchTerm(targetEmp.name);
                        setForceShowAll(true);

                        // Si navegamos a un nuevo cliente/objetivo necesitamos más tiempo para que cargue
                        setTimeout(() => {
                            const dateStr = getDateKey(targetDate!);
                            const key = `${targetEmp.id}_${dateStr}`;
                            const shift = pendingChanges[key] || shiftsMap[key];
                            const absence = absencesMap[key];

                            const absHandled = shift && ['V','L','PG','A','E','AA'].includes(shift.code || '');
                            if (isVacancyAbsence && !absHandled) {
                                setVacancyData(absence ? { ...absence, source: 'AUSENCIA' } : { ...notif, source: 'AUSENCIA' });
                                setSelectedReplacement('');
                                setShowVacancyModal(true);
                            } else if ((shift && absence) || (shift && shift.hasNovedad)) {
                                findNeighbors(shift, dateStr);
                                if (absence && absence.type) {
                                    setVacancyData({ ...absence, source: 'AUSENCIA' });
                                    setSelectedReplacement('');
                                    setShowVacancyModal(true);
                                } else {
                                    setShowConflictModal(true);
                                }
                            }

                            setSelectedCell({
                                empId: targetEmp.id,
                                dateStr: dateStr,
                                currentShift: shift,
                                absence: absence
                            });

                            const initialPos = shift?.positionName || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
                            setActivePosition(initialPos);

                            toast.info(`Navegando a: ${targetEmp.name}`);
                        }, didNavigate ? 700 : 300);
                    } else if (isVacancyAbsence) {
                        // Empleado no visible en la grilla actual: navegar mes y abrir modal igual
                        setTimeout(() => {
                            setVacancyData({ ...notif, source: 'AUSENCIA' });
                            setSelectedReplacement('');
                            setShowVacancyModal(true);
                        }, 150);
                    }
                }
            } catch (e) { console.error("Error navegando", e); }
        } else if (isVacancyAbsence) {
            // Sin fecha: abrir modal directamente
            setVacancyData({ ...notif, source: 'AUSENCIA' });
            setSelectedReplacement('');
            setShowVacancyModal(true);
        }
    };

    const loadHistory = async () => { if (!selectedObjective) { toast.error("Seleccione un objetivo"); return; } try { const q = query(collection(db, 'planificaciones_historial'), where('period', '==', `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`)); const snap = await getDocs(q); const versions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((v: any) => v.objectiveId === selectedObjective).sort((a:any, b:any) => b.timestamp.seconds - a.timestamp.seconds); setHistoryVersions(versions); setShowHistoryModal(true); } catch (e) { toast.error("Error historial"); } };
    const handleViewSnapshot = (v: any) => {
        try {
            const data = JSON.parse(v.snapshot);
            setCompareShowOnlyDiffs(false);
            setComparingSnapshot({ id: v.id, date: new Date(v.timestamp.seconds * 1000), user: v.user, data });
            setShowHistoryModal(false);
        } catch (e) {
            toast.error('Error al cargar versión histórica');
        }
    };
    const exitSnapshotMode = () => {
        setComparingSnapshot(null);
        setCompareShowOnlyDiffs(false);
        setShowCompareDiffModal(false);
        setShowCompareSummaryModal(false);
    };

    const handleRowDragStart = (e: React.DragEvent, idx: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    };
    const handleRowDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverVisual(idx);
    };
    const handleRowDrop = (e: React.DragEvent, toIdx: number) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        setDragOverVisual(null);
        if (isNaN(fromIdx) || fromIdx === toIdx) return;
        const ids = displayedEmployees.map((emp: any) => emp.id);
        const [removed] = ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, removed);
        const key = selectedObjective || '__all__';
        const newMap = { ...customOrderMap, [key]: ids };
        setCustomOrderMap(newMap);
        try { localStorage.setItem('planif_emp_order', JSON.stringify(newMap)); } catch {}
    };
    const clearCustomOrder = () => {
        const key = selectedObjective || '__all__';
        const newMap = { ...customOrderMap };
        delete newMap[key];
        setCustomOrderMap(newMap);
        try { localStorage.setItem('planif_emp_order', JSON.stringify(newMap)); } catch {}
    };

    const getEmpDefaultPos = (empId: string) => empDefaultPos[`${empId}___${selectedObjective}`] || null;
    const getEmpDefaultShift = (empId: string) => empDefaultShift[`${empId}___${selectedObjective}`] || null;

    const clearAllPositions = async () => {
        if (!selectedObjective) return;
        if (!confirm('¿Quitar todos los puestos asignados de este objetivo?')) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        try {
            const result = await clearPlanificacionObjectivePositions({
                empresaId,
                selectedObjective,
                year,
                month,
                empDefaultPos,
                empDefaultShift,
                employees,
            });
            setEmpDefaultPos(result.empDefaultPos);
            setEmpDefaultShift(result.empDefaultShift);
            toast.success('Puestos quitados');
        } catch {
            toast.error('No se pudo limpiar los puestos');
        }
    };

    const refreshCronogramaView = async () => {
        if (!selectedObjective) {
            toast.error('Seleccioná un objetivo');
            return;
        }
        setIsRefreshingCrono(true);
        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth() + 1;
            const refreshed = await loadPlanificacionCronogramaRefresh({
                empresaId,
                migracionCompleta,
                scopeEmpresa,
                selectedObjective,
                year,
                month,
                employees,
            });
            setPublishStatusMap(prev => ({
                ...prev,
                [refreshed.lookupKey]: refreshed.publishStatusEntry,
            }));
            setEmpDefaultPos(refreshed.empDefaultPos);
            setEmpDefaultShift(refreshed.empDefaultShift);
            setShiftsMap(prev => {
                const next = refreshed.mergeShiftsMap(prev);
                if (empresaId) {
                    const cacheKey = planningMonthCacheKey(empresaId, year, month);
                    const cached = getCachedPlanningMonth(cacheKey);
                    const cellPatch: Record<string, any[]> = { ...(cached?.cellTurnosMap || {}) };
                    const idsPatch: Record<string, string[]> = { ...(cached?.allShiftIds || {}) };
                    for (const { key, value } of refreshed.monthEntries) {
                        cellPatch[key] = [value, ...(cellPatch[key] || []).filter((x) => x?.id !== value.id)];
                        if (value.id) {
                            const ids = idsPatch[key] || [];
                            if (!ids.includes(value.id)) idsPatch[key] = [...ids, value.id];
                        }
                    }
                    setCachedPlanningMonth(cacheKey, {
                        shiftsMap: next,
                        cellTurnosMap: cellPatch,
                        allShiftIds: idsPatch,
                        turaMap: cached?.turaMap || {},
                        secondBlockMap: cached?.secondBlockMap || {},
                        rfzVacantes: cached?.rfzVacantes || [],
                        rfzTodos: cached?.rfzTodos || [],
                    });
                    setCellTurnosMap(cellPatch);
                }
                return next;
            });
            setDataRefreshNonce(n => n + 1);
            toast.success('Cronograma actualizado');
        } catch (e) {
            console.error('[plan] refreshCronogramaView', e);
            toast.error('No se pudo actualizar el cronograma');
        } finally {
            setIsRefreshingCrono(false);
        }
    };

    const computeEmpPosPickerLayout = (anchorRect: DOMRect) => {
        const margin = 8;
        const width = 260;
        const vv = window.visualViewport;
        const vTop = vv?.offsetTop ?? 0;
        const vLeft = vv?.offsetLeft ?? 0;
        const vh = vv?.height ?? window.innerHeight;
        const vw = vv?.width ?? window.innerWidth;

        const summaryBar = document.querySelector('[data-planning-summary-bar]') as HTMLElement | null;
        const bottomReserve = summaryBar
            ? Math.max(summaryBar.getBoundingClientRect().height + margin, 64)
            : 72;
        const usableBottom = vTop + vh - bottomReserve;

        const headerH = 58;
        const rowH = 76;
        const footerBtnH = 40;
        const idealH = headerH + positionStructure.length * rowH + footerBtnH;
        const minH = 140;
        const capH = Math.min(idealH, 420);

        const spaceBelow = usableBottom - anchorRect.bottom - 4;
        const spaceAbove = anchorRect.top - vTop - margin;
        const anchorCenter = anchorRect.top + anchorRect.height / 2;
        const lowerHalf = anchorCenter > vTop + (vh - bottomReserve) * 0.42;

        const fitsBelow = spaceBelow >= minH;
        const fitsAbove = spaceAbove >= minH;

        let openDown: boolean;
        if (lowerHalf && fitsAbove) openDown = false;
        else if (!lowerHalf && fitsBelow) openDown = true;
        else if (fitsAbove && !fitsBelow) openDown = false;
        else if (fitsBelow && !fitsAbove) openDown = true;
        else openDown = spaceBelow >= spaceAbove;

        let maxHeight = Math.min(capH, Math.max(minH, openDown ? spaceBelow : spaceAbove));
        let y = openDown ? anchorRect.bottom + 4 : anchorRect.top - maxHeight - 4;
        y = Math.max(vTop + margin, Math.min(y, usableBottom - maxHeight));

        // Si no entra anclado al botón, panel flotante centrado en el área útil
        const anchoredClips = y + maxHeight > usableBottom + 1 || maxHeight < minH;
        let floating = false;
        if (anchoredClips) {
            floating = true;
            maxHeight = Math.min(capH, Math.max(minH, vh - bottomReserve - margin * 2));
            y = vTop + margin + Math.max(0, (vh - bottomReserve - maxHeight) / 2);
        }

        let x = floating ? vLeft + (vw - width) / 2 : anchorRect.left;
        if (x + width > vLeft + vw - margin) x = vLeft + vw - width - margin;
        x = Math.max(vLeft + margin, x);

        return { x, y, maxHeight, floating };
    };

    const openEmpPosPickerAt = (empId: string, anchorEl: HTMLElement) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const layout = computeEmpPosPickerLayout(anchorEl.getBoundingClientRect());
                setEmpPosPicker({ empId, ...layout });
            });
        });
    };

    useEffect(() => {
        if (!empPosPicker) return;
        const reposition = () => {
            const btn = document.querySelector(`[data-emp-pos-btn="${empPosPicker.empId}"]`) as HTMLElement | null;
            if (!btn) return;
            const layout = computeEmpPosPickerLayout(btn.getBoundingClientRect());
            setEmpPosPicker((prev) => (prev ? { ...prev, ...layout } : prev));
        };
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('scroll', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('scroll', reposition);
        };
    }, [empPosPicker?.empId, positionStructure.length]);

    const saveEmpPos = async (empId: string, posName: string | null, shiftCode?: string | null) => {
        if (!selectedObjective) return;
        if (!empresaId) {
            toast.error('Seleccioná una empresa antes de asignar puestos');
            return;
        }
        const prevPosMap = { ...empDefaultPos };
        const prevShiftMap = { ...empDefaultShift };
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        try {
            const result = await savePlanificacionEmpPosition({
                empresaId,
                selectedObjective,
                year,
                month,
                empId,
                posName,
                shiftCode,
                empDefaultPos,
                empDefaultShift,
                employees,
            });
            setEmpDefaultPos(result.empDefaultPos);
            setEmpDefaultShift(result.empDefaultShift);
            setEmpPosPicker(null);
        } catch (err: any) {
            setEmpDefaultPos(prevPosMap);
            setEmpDefaultShift(prevShiftMap);
            const permDenied = err?.code === 'permission-denied' || /permission/i.test(String(err?.message || ''));
            toast.error(permDenied
                ? 'Sin permiso para asignar puestos (revisá rol / empresa del usuario)'
                : 'No se pudo guardar el puesto asignado');
        }
    };

    const handleUnassignEmployee = async (emp: any) => {
        if (!selectedObjective) return;
        if (emp.preferredObjectiveId !== selectedObjective) { toast.error("Error asignación."); return; }
        if (!confirm(`¿CONFIRMAR DESVINCULACIÓN?`)) return;
        try {
            const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
            delete nextDotacion[selectedObjective];
            await updateDoc(doc(db, 'empleados', emp.id), {
                preferredObjectiveId: null,
                planificacionDotacion: nextDotacion,
            });
            await addDoc(collection(db, 'audit_logs'), { action: 'DESVINCULACION_OBJETIVO', module: 'PLANIFICADOR', details: `Desvinculó a ${emp.name}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid, empresaId });
            toast.success("Desvinculado");
        } catch (e) { toast.error("Error"); }
    };
    const handleMarkAllRead = async () => { if (!confirm("¿Marcar todas como leídas?")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) { const ref = doc(db, 'novedades', n.id); batch.update(ref, { viewed: true, status: 'read' }); } }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Bandeja limpia"); };
    const handleDeleteAllNotifications = async () => { if (!confirm("¿Eliminar permanentemente todas las notificaciones? Esta acción no se puede deshacer.")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) batch.delete(doc(db, 'novedades', n.id)); }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Notificaciones eliminadas"); };

    const repositionNotifPanel = useCallback(() => {
        const rect = notifBtnRef.current?.getBoundingClientRect();
        if (rect) setNotifPanelTop(rect.bottom + 8);
    }, []);

    useEffect(() => {
        if (!showNotifications) return;
        repositionNotifPanel();
        window.addEventListener('scroll', repositionNotifPanel, true);
        window.addEventListener('resize', repositionNotifPanel);
        return () => {
            window.removeEventListener('scroll', repositionNotifPanel, true);
            window.removeEventListener('resize', repositionNotifPanel);
        };
    }, [showNotifications, repositionNotifPanel]);
    const handleTransferEmployee = async (emp: any) => { if (!selectedObjective) return; if (!confirm(`¿Transferir a ${emp.name} a este objetivo?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); await addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'TRANSFERENCIA_OBJETIVO', module: 'PLANIFICADOR', details: `Transfirió a ${emp.name} al objetivo ${getObjectiveName(selectedObjective)}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid, objectiveId: selectedObjective, objectiveName: getObjectiveName(selectedObjective) }, empresaId)); toast.success("Transferencia exitosa"); } catch (e) { toast.error("Error al transferir"); } };
    const handleDelete = async () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!selectedCell) return;
        if (isPlanningDateLocked(selectedCell.dateStr)) { toast.warning("Bloqueado."); return; }
        if (isShiftConsolidated(selectedCell.currentShift)) { toast.warning("Turno consolidado/fichado: no se puede borrar desde el planificador."); return; }

        // Si es una ausencia registrada (colección 'ausencias'), no se borra con pendingChanges.
        // Permitimos borrar solo si era un cambio pendiente (ej: una marca en borrador).
        if (selectedCell.absence) {
            const keyAbs = `${selectedCell.empId}_${selectedCell.dateStr}`;
            const pending = pendingChanges[keyAbs];
            if (!pending) { toast.warning("Ausencia/vacaciones registrada: se gestiona desde RRHH."); return; }
        }

        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const newChanges = { ...pendingChanges };
        newChanges[key] = { isDeleted: true };
        commitPendingChanges(newChanges);
        setSelectedCell(null);
        toast.info("Marcado para borrar.", { id: 'plan-cambio', duration: 2000 });
    };
    const verifySupervisorPin = async (pin: string): Promise<{ ok: boolean; name: string }> => {
        if (!/^\d{4}$/.test(pin)) return { ok: false, name: '' };
        const snap = await getDocs(query(collection(db, 'system_users'), where('supervisorPin', '==', pin)));
        if (snap.empty) return { ok: false, name: '' };
        const u = snap.docs[0].data();
        return { ok: true, name: `${u.firstName} ${u.lastName}` };
    };

    const submitSupervisorAuth = async () => {
        if (authPin.length !== 4 || authLoading || !authModal.pendingFn) return;
        setAuthLoading(true);
        const result = await verifySupervisorPin(authPin);
        if (!result.ok) {
            setAuthError('PIN incorrecto. Intentá de nuevo.');
            setAuthPin('');
            setAuthLoading(false);
            return;
        }
        try {
            await authModal.pendingFn();
            if (authModal.isSaveFlow) {
                const newAuthorized = new Set(authorizedOver200IdsRef.current);
                authModal.employees.forEach(e => { if ((e as any).empId) newAuthorized.add((e as any).empId); });
                authorizedOver200IdsRef.current = newAuthorized;
                setAuthorizedOver200Ids(newAuthorized);
                await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    timestamp: serverTimestamp(),
                    action: 'OVERRIDE_200H',
                    module: 'PLANIFICADOR',
                    actorName: result.name,
                    details: `${authModal.operatorName || 'Operador'} asignó turno a ${authModal.employees.map(e => `${e.name} (${e.hours}h)`).join(', ')} superando 200hs — autorizó: ${result.name}`,
                    objectiveId: selectedObjective || undefined,
                    objectiveName: selectedObjective ? getObjectiveName(selectedObjective) : undefined,
                }, empresaId));
            } else if (authModal.auditAction) {
                await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    timestamp: serverTimestamp(),
                    action: authModal.auditAction,
                    module: 'PLANIFICADOR',
                    actorName: result.name,
                    actorUid: getAuth().currentUser?.uid || null,
                    details: authModal.auditDetails || authModal.employees.map(e => e.name).join(', '),
                    objectiveId: selectedObjective || undefined,
                    objectiveName: selectedObjective ? getObjectiveName(selectedObjective) : undefined,
                }, empresaId));
            }
        } finally {
            setAuthModal({ pendingFn: null, employees: [] });
            setAuthPin('');
            setAuthLoading(false);
        }
    };

    const requestSupervisorFrancoAuth = (
        conflicts: FrancoCoverageConflict[],
        onAuthorized: () => void | Promise<void>,
        contextLabel = 'cobertura',
    ) => {
        if (conflicts.length === 0) {
            void onAuthorized();
            return;
        }
        const unique = [...new Map(conflicts.map((c) => [`${c.employeeId}_${c.dateStr}_${c.role}`, c])).values()];
        const details = formatFrancoConflictSummary(unique);
        setAuthModal({
            pendingFn: async () => { await onAuthorized(); },
            employees: unique.map((c) => ({
                name: c.employeeName,
                hours: 0,
                detail: `${c.role === 'SUBSTITUTE' ? 'Suplente' : c.role === 'EXTENSION' ? 'Extensión' : 'Adelanto'} · ${c.francoCode}`,
            })),
            description: (
                <>
                    La {contextLabel} involucra guardias en <strong>franco planificado (FT)</strong> — costo extra CCT.
                    Preferí RET, ESC o guardias libres. Si confirmás, queda registrado en auditoría.
                </>
            ),
            auditAction: 'AUTORIZACION_FRANCO_COBERTURA',
            auditDetails: details,
        });
    };

    const handleSaveAll = async () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        const count = Object.keys(pendingChanges).length;
        if (count === 0) return;
        const _userCount = Object.values(pendingChanges).filter((v: any) => !v?._isAutoRotation).length;
        const _rotCount = count - _userCount;
        const _confirmMsg = _userCount > 0
            ? `¿Confirmar y guardar ${_userCount} cambio${_userCount !== 1 ? 's' : ''}${_rotCount > 0 ? ` (+ ${_rotCount} turno${_rotCount !== 1 ? 's' : ''} de ciclo)` : ''}?`
            : `¿Guardar ${_rotCount} turno${_rotCount !== 1 ? 's' : ''} de ciclo?`;
        if (!confirm(_confirmMsg)) return;

        // Verificar si algún empleado superaría las 200h (saltar los ya autorizados esta sesión)
        const overCap: { empId: string; name: string; hours: number }[] = [];
        Object.keys(pendingChanges).forEach(key => {
            const empId = key.split('_')[0];
            if (authorizedOver200Ids.has(empId)) return;
            const hours = empMonthlyHours[empId] || 0;
            if (hours > planningLimits.monthly) {
                const empName = displayedEmployees.find((e: any) => e.id === empId)?.name || empId;
                if (!overCap.some(e => e.empId === empId)) overCap.push({ empId, name: empName, hours: Math.round(hours) });
            }
        });

        const doSave = () => {
            const jobPending = { ...pendingChanges };
            const jobKeys = Object.keys(jobPending);
            if (jobKeys.length === 0) return;

            const jobShiftsMap: Record<string, any> = {};
            const jobAllShiftIds: Record<string, string[]> = {};
            for (const key of jobKeys) {
                if (shiftsMap[key]) jobShiftsMap[key] = shiftsMap[key];
                if (allShiftIds[key]?.length) jobAllShiftIds[key] = [...allShiftIds[key]];
            }
            // Snapshot completo del mes (para historial): estado post-guardado = grilla + pendientes.
            // No usar solo pending: eso deja el Histórico vacío y parece «Solo cambios» permanente.
            const snapDateKeys = daysInMonth.map((d) => getDateKey(d));
            const snapEmpIds = new Set([
                ...collectSnapshotEmployeeIds(jobPending, shiftsMap, selectedObjective),
                ...displayedEmployees.map((e: { id: string }) => e.id),
            ]);
            const snapshotData = buildPlanningSnapshotFromGrid({
                employeeIds: [...snapEmpIds],
                dateKeys: snapDateKeys,
                shiftsMap,
                pendingChanges: jobPending,
                objectiveId: selectedObjective,
            });
            const jobNovedades = { ...pendingNovedades };
            const jobPackages = [...pendingRecompositionPackages];
            const jobCount = jobKeys.length;

            setPendingChanges((prev) => {
                const next = { ...prev };
                for (const k of jobKeys) delete next[k];
                return next;
            });
            setPendingNovedades({});
            setPendingRecompositionPackages([]);
            clearUndoStack();
            setBackgroundSaveCount((c) => c + 1);

            planToastSaving(jobCount);

            void executePlanificacionSaveJob({
                jobPending,
                jobShiftsMap,
                jobAllShiftIds,
                jobNovedades,
                jobPackages,
                jobCount,
                snapshotData,
                empresaId,
                selectedObjective,
                selectedClient,
                currentDate,
                employees,
                positionStructure,
                correctionMode,
                publishStatusMap,
                activeActorName,
                scopeEmpresa,
                resolveObjectiveForEmp,
                getObjectiveName,
                setPendingChanges,
                setPendingNovedades,
                setPendingRecompositionPackages,
                setNeedsRepublishMap,
                setBackgroundSaveCount,
            });
        };

        if (overCap.length > 0) {
            setAuthModal({ pendingFn: doSave, employees: overCap, operatorName: activeActorName || operatorName, isSaveFlow: true });
            setAuthPin('');
            setAuthError('');
            return;
        }

        doSave();
    };

    const openPublishConfirm = () => {
        if (!selectedObjective || !canPublishPlanning) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;
        const sla = evaluatePublishSlaState(objectiveMonthSlaBaseHours, slaVendidas, objectiveCoverageGapReport);
        const result = buildPublishConfirmModalState({
            selectedObjective,
            year,
            month,
            objectiveName,
            isSuperAdmin,
            publishStatusMap,
            sla,
        });
        if (result.blocked) {
            toast.error(result.errorMessage, { duration: result.errorDuration });
            return;
        }
        setPublishConfirmModal(result.modal);
        setPublishConfirmPin('');
        setPublishConfirmPinError('');
    };

    const executePublish = async () => {
        if (!selectedObjective || !canPublishPlanning) return;
        if (!empresaId) {
            toast.error('Seleccioná una empresa antes de publicar');
            return;
        }
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const { slaHoursMismatch, hasCoverageGaps } = evaluatePublishSlaState(
            objectiveMonthSlaBaseHours,
            slaVendidas,
            objectiveCoverageGapReport,
        );
        const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;
        const clientName = clients.find((c: any) => c.id === selectedClient)?.name || selectedClient || '';
        setPublishConfirmModal(null);
        setIsPublishing(true);
        try {
            const result = await publishPlanificacionMonth({
                empresaId,
                migracionCompleta,
                selectedObjective,
                selectedClient,
                year,
                month,
                objectiveName,
                clientName,
                isSuperAdmin,
                slaHoursMismatch,
                hasCoverageGaps,
            });
            setPublishStatusMap(prev => ({
                ...prev,
                [result.publishLookupKey]: { publishedAt: new Date(), publishedBy: result.actorName },
            }));
            setNeedsRepublishMap(prev => ({ ...prev, [result.publishLookupKey]: false }));
            setCorrectionMode(false);
            toast.success(
                result.rfzPublished > 0
                    ? `Cronograma publicado — ${result.totalPublished} turno(s) notificado(s) (incluye ${result.rfzPublished} refuerzo/s RFZ)`
                    : `Cronograma publicado — ${result.totalPublished} turno(s) notificado(s)`,
            );
        } catch (e) {
            console.error(e);
            toast.error('Error al publicar');
        } finally {
            setIsPublishing(false);
        }
    };

    const handleUnpublish = async () => {
        if (!selectedObjective || !isSuperAdmin || isUnpublishing) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;

        const confirmed = confirm(
            `[SUPERADMIN]\n\n¿Despublicar el cronograma de ${objectiveName} — ${String(month).padStart(2, '0')}/${year}?\n\n` +
            'Esto vuelve el objetivo/mes a BORRADOR y deja de mostrarlo como cronograma publicado. No borra turnos ni toca coberturas operativas.'
        );
        if (!confirmed) return;

        setIsUnpublishing(true);
        try {
            const { restoredDrafts, publishLookupKey } = await unpublishPlanificacionMonth({
                empresaId,
                migracionCompleta,
                selectedObjective,
                year,
                month,
                objectiveName,
            });
            setPublishStatusMap(prev => ({ ...prev, [publishLookupKey]: null }));
            setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: false }));
            setCorrectionMode(false);
            toast.success(`Cronograma despublicado — ${restoredDrafts} turno(s) vuelven a borrador`);
        } catch (e) {
            console.error(e);
            toast.error('Error al despublicar');
        } finally {
            setIsUnpublishing(false);
        }
    };

    const resolveConflict = async (type: 'SPLIT' | 'FULL_COVERAGE') => {
        await resolvePlanificacionConflict({
            type,
            selectedCell,
            conflictNeighbors,
            setShowConflictModal,
            setFrancoMode,
            setSelectedCell,
        });
    };
    const handleRRHHSubmit = () => {
        submitPlanificacionRRHHNovedad({
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selectedCell,
            rrhhData,
            employees,
            setPendingChanges,
            setPendingNovedades,
            setShowRRHHModal,
            setSelectedCell,
        });
    };
    const finalizeVacancyModal = () => {
        resetPlanificacionVacancyModal({
            setShowVacancyModal,
            setVacancyData,
            setVacancyReplacementSearch,
            setVacancyReplacementOpen,
            setVacancyActiveDates,
            setVacancyDayCoverages,
            setVacancyFrancoAuthApproved,
            setVacancyEditingDay,
            setVacancyPickerTab,
            setVacancySplitExtId,
            setVacancySplitAdelId,
            setVacancyApplyToAllSelected,
        });
    };

    const handleProcessVacancy = () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!vacancyData?.startDate) return;
        const activeDays = [...vacancyActiveDates].sort();
        if (activeDays.length === 0) { toast.error('Seleccioná al menos un día a procesar'); return; }
        const days = buildVacancyProcessDays({
            activeDays,
            vacancyData,
            vacancyDayCoverages,
            selectedReplacement,
            employees,
            shiftsMap,
            pendingChanges,
            effectivePosStructure,
            activePosition,
            vacancyGapBandOverride,
            currentDate,
        });

        const runApplyVacancy = (authorizeFranco: boolean) => {
            try {
                const result = applyPlanificacionVacancyCoverage({
                    pendingChanges,
                    vacancyData,
                    days,
                    selectedObjective,
                    activePosition,
                    shiftsMap,
                    employees,
                    effectivePosStructure,
                    selectedClient,
                    vacancyGapBandOverride,
                    activeDays,
                    authorizeFrancoTrabajado: authorizeFranco,
                    resolveSuggestedGapBandForPosition,
                    currentDate,
                });
                setPendingChanges(result.changes);
                finalizeVacancyModal();
                toastVacancyApplyResult(result.absCode, result.count, result.covered, result.splitCovered, result.cleared);
            } catch (e) {
                toastVacancyApplyError(e);
            }
        };

        const francoConflicts = collectPlanificacionVacancyFrancoConflicts(days, shiftsMap, pendingChanges, employees);
        if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
            requestSupervisorFrancoAuth(francoConflicts, () => {
                setVacancyFrancoAuthApproved(true);
                runApplyVacancy(true);
            }, 'cobertura de licencia');
            return;
        }
        runApplyVacancy(francoConflicts.length > 0 || vacancyFrancoAuthApproved);
    };
    
    const applyBulkChange = (shiftConfig: any, opts?: { onlyEmpId?: string }) => {
        applyPlanificacionBulkChange({
            shiftConfig,
            opts,
            allowPlanningMultiSelect,
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selection,
            daysInMonth,
            isPlanningDateLocked,
            selectedGrupo,
            grupoUnifiedMode,
            selectedObjective,
            bulkEmpObjectiveOverrides,
            bulkTargetObjectiveId,
            grupoSlaMap,
            positionStructure,
            pendingChanges,
            displayedEmployees,
            shiftsMap,
            autoSelectedCyclesRef,
            autoCycles,
            activePosition,
            empDefaultPos,
            bulkEmpPositionFilter,
            bulkBarPosition,
            absencesMap,
            slaIdToObjId,
            resolveNativeObjectiveInGrupo,
            checkRestricciones,
            isBulkCovBlocked,
            commitPendingChanges,
        });
    };

    const applyBulkPositionFill = (posName: string) => {
        applyPlanificacionBulkPositionFill({
            posName,
            allowPlanningMultiSelect,
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selection,
            daysInMonth,
            isPlanningDateLocked,
            selectedGrupo,
            grupoUnifiedMode,
            selectedObjective,
            bulkEmpObjectiveOverrides,
            bulkTargetObjectiveId,
            grupoSlaMap,
            positionStructure,
            pendingChanges,
            displayedEmployees,
            shiftsMap,
            empDefaultShift,
            absencesMap,
            slaIdToObjId,
            autoSelectedCyclesRef,
            autoCycles,
            resolveNativeObjectiveInGrupo,
            checkRestricciones,
            isBulkCovBlocked,
            commitPendingChanges,
            applyBulkChange,
        });
    };

    const checkRestricciones = (
        emp: any,
        dateStr: string,
        positionName?: string | null,
        shiftCode?: string | null,
        objectiveIdOverride?: string | null,
        structureOverride?: any[],
    ) => evaluatePlanificacionRestricciones({
        emp,
        dateStr,
        positionName,
        shiftCode,
        objectiveIdOverride,
        structureOverride,
        selectedObjective,
        positionStructure,
        getObjectiveName,
        activePosition,
        selectedCell,
        selectedClient,
        displayedEmployees,
        pendingChanges,
        shiftsMap,
        resolveEffectiveShiftObjectiveId,
    });

    const isBulkCovBlocked = (empId: string, posName: string, code: string): boolean =>
        isPlanificacionBulkCovBlocked(empId, posName, code, activeSlaPositionAssignments);

    const applyToPending = (config: any) => {
        if (!selectedCell) return;
        applyPlanificacionToPending({
            config,
            selectedCell,
            displayedEmployees,
            activePosition,
            pendingChanges,
            selectedGrupo,
            grupoUnifiedMode,
            cellPlanningObjectiveId,
            resolveObjectiveForEmp,
            activeSlaServiceRules,
            activeSlaServiceRotations,
            shiftsMap,
            dotacionBaseEmployees,
            selectedObjective,
            currentDate,
            positionStructure,
            checkRestricciones,
            commitPendingChanges,
            setSelectedCell,
            setActivePosition,
            setFrancoMode,
            setPendingAssignment,
            setSwapConfig,
            setShowSwapModal,
        });
    };

    const applyRecompositionPackage = (
        updates: Record<string, any>,
        pkg: RecompositionPackage,
        novedad?: PendingAbsenceNovedad,
    ) => {
        applyPlanificacionRecompositionPackage({
            updates,
            pkg,
            novedad,
            setPendingChanges,
            setPendingNovedades,
            setPendingRecompositionPackages,
            setSelectedCell,
            setRecompositionModalOpen,
        });
    };

    const handleAssignDeployment = (intent: 'SURPLUS' | 'TRAINING') => {
        if (!activePosition || activePosition === 'General' || activePosition === 'Retén') {
            toast.error('Seleccioná un puesto en la grilla antes de asignar refuerzo o escuela');
            return;
        }
        setDeployBandPicker(intent);
    };

    /** Bandas disponibles para ESC/REF = turnos laborales reales del puesto (no M/T/N fijos). */
    const getDeploymentBandsForPosition = useCallback((
        positionName: string,
        structure?: any[],
        dateStr?: string | null,
    ) => {
        const struct = structure || effectivePosStructure || positionStructure || [];
        const pos = struct.find((p: any) => p.positionName === positionName);
        if (!pos) return [] as { code: string; name?: string; hours?: number; startTime?: string; endTime?: string }[];
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;
        const dayLetter = dateStr ? getDayLetter(dateStr) : '';
        const raw = dateStr
            ? filterShiftsForPlanningDay(pos.shifts || [], pos, dayLetter, dateStr, cycles)
            : (pos.shifts || []);
        const NON = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC', 'RFZ', 'TURA']);
        const seen = new Set<string>();
        const out: { code: string; name?: string; hours?: number; startTime?: string; endTime?: string }[] = [];
        for (const s of raw) {
            const code = String(s.code || '').trim().toUpperCase();
            if (!code || NON.has(code) || seen.has(code)) continue;
            seen.add(code);
            out.push({
                code,
                name: s.name,
                hours: Number(s.hours) || undefined,
                startTime: s.startTime,
                endTime: s.endTime,
            });
        }
        return out;
    }, [effectivePosStructure, positionStructure, autoCycles]);

    const deployBandOptions = useMemo(() => {
        if (!deployBandPicker || !activePosition || activePosition === 'General' || activePosition === 'Retén') {
            return [] as { code: string; name?: string; hours?: number; startTime?: string; endTime?: string }[];
        }
        return getDeploymentBandsForPosition(activePosition, effectivePosStructure, selectedCell?.dateStr);
    }, [deployBandPicker, activePosition, effectivePosStructure, selectedCell?.dateStr, getDeploymentBandsForPosition]);

    const confirmDeploymentBand = (band: string, shiftOverride?: { hours?: number; startTime?: string; endTime?: string; name?: string } | null) => {
        if (!deployBandPicker || !selectedCell) return;
        const config = buildDeploymentShiftConfig(
            deployBandPicker,
            band,
            activePosition || 'General',
            shiftOverride,
        );
        setDeployBandPicker(null);
        handleAssignShift(config, activePosition || 'General');
    };

    const openBulkDeployPicker = (
        intent: 'SURPLUS' | 'TRAINING',
        opts?: { onlyEmpId?: string; positionName?: string },
    ) => {
        if (!allowPlanningMultiSelect) {
            toast.message('Cronograma publicado — activá modo Corregir para edición masiva.');
            return;
        }
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; }
        if (!selection.start || !selection.end) return;
        const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
        const dateStr = daysInMonth[minC] ? getDateKey(daysInMonth[minC]) : null;
        if (dateStr && isPlanningDateLocked(dateStr) && intent === 'SURPLUS') {
            toast.warning('Periodo cerrado — solo podés asignar ESC (no REF) en masa.');
            return;
        }

        let positionName = String(opts?.positionName || '').trim();
        let structure = bulkEffectiveStructure || positionStructure || [];

        if (opts?.onlyEmpId) {
            const emp = displayedEmployees.find((e: any) => e.id === opts.onlyEmpId);
            if (emp) {
                const covObjId = (selectedGrupo && grupoUnifiedMode)
                    ? (resolveNativeObjectiveInGrupo(emp)
                        || bulkEmpObjectiveOverrides[emp.id]
                        || bulkTargetObjectiveId
                        || selectedGrupo.objectiveIds[0]
                        || selectedObjective)
                    : selectedObjective;
                if (selectedGrupo && grupoUnifiedMode && covObjId && grupoSlaMap[covObjId]?.length) {
                    structure = grupoSlaMap[covObjId];
                }
                if (!positionName) {
                    positionName = bulkEmpPositionFilter[opts.onlyEmpId]
                        || (covObjId ? (empDefaultPos[`${opts.onlyEmpId}___${covObjId}`] || '') : '')
                        || resolveBulkPanelEmpPosition(emp, covObjId || undefined)
                        || bulkBarPosition
                        || '';
                }
            }
        }

        if (!positionName) {
            positionName = bulkBarPosition
                || (structure.length === 1 ? structure[0]?.positionName : '')
                || (activePosition && activePosition !== 'General' && activePosition !== 'Retén' ? activePosition : '')
                || '';
        }

        if (!positionName || positionName === 'General' || positionName === 'Retén') {
            toast.error('Elegí un puesto (paleta) antes de asignar REF o ESC en masa');
            return;
        }

        const bands = getDeploymentBandsForPosition(positionName, structure, dateStr);
        if (!bands.length) {
            toast.error(`El puesto "${positionName}" no tiene turnos SLA para escuela/refuerzo en esta selección`);
            return;
        }

        setBulkDeployPicker({
            intent,
            onlyEmpId: opts?.onlyEmpId,
            positionName,
            bands,
        });
    };

    const confirmBulkDeployBand = (band: string, shiftOverride?: { hours?: number; startTime?: string; endTime?: string; name?: string } | null) => {
        if (!bulkDeployPicker) return;
        const config = buildDeploymentShiftConfig(
            bulkDeployPicker.intent,
            band,
            bulkDeployPicker.positionName,
            shiftOverride,
        );
        const onlyEmpId = bulkDeployPicker.onlyEmpId;
        setBulkDeployPicker(null);
        applyBulkChange(config, onlyEmpId ? { onlyEmpId } : undefined);
    };

    const handleAssignShift = async (shiftConfig: any, positionName: string) => {
        assignPlanificacionShift({
            shiftConfig,
            positionName,
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selectedCell,
            isPlanningDateLocked,
            positionStructure,
            correctionMode,
            francoMode,
            canAssignFT,
            setFrancoMode,
            selectedObjective,
            getObjectiveName,
            applyToPending,
            checkLaborRules,
            planningLimits,
            employees,
            plannedNovedad: modifiers.plannedNovedad,
            setAuthWarningMessage,
            setPendingAssignment,
        });
    };

    const confirmPendingAssignment = () => {
        confirmPlanificacionPendingAssignment({
            pendingAssignment,
            francoMode,
            canAssignFT,
            plannedNovedad: modifiers.plannedNovedad,
            applyToPending,
            setFrancoMode,
            setPendingAssignment,
            setAuthWarningMessage,
        });
    };

    const cancelPendingAssignment = () => {
        resetPlanificacionPendingAssignment(setPendingAssignment, setAuthWarningMessage);
    };

    const getShiftFor = (empId: string, dateStr: string) =>
        getPlanificacionShiftFor(empId, dateStr, pendingChanges, shiftsMap);

    const executeSwap = () => {
        executePlanificacionSwap({
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selectedCell,
            selectedSwapTarget,
            selectedSwapDate,
            currentDate,
            pendingChanges,
            shiftsMap,
            employees,
            activePosition,
            dominantPositionName: dominantPosition?.positionName,
            commitPendingChanges,
            setShowSwapModal,
            setSwapConfig,
            setCoverageStep,
            setSelectedSwapTarget,
            setSelectedSwapDate,
            setSwapSearchTerm,
        });
    };

    const handleSelectDate = (dateStr: string) => { setSelectedSwapDate(dateStr); };

    /** Copia la selección actual al portapapeles. Devuelve bounds o null. */
    const copySelectionToClipboard = useCallback((asCut: boolean) => copyPlanificacionSelectionToClipboard({
        asCut,
        allowPlanningMultiSelect,
        selection,
        displayedEmployees,
        daysInMonth,
        pendingChanges,
        shiftsMap,
        setClipboard,
        setClipboardDim,
        setClipboardIsCut,
    }), [allowPlanningMultiSelect, selection, displayedEmployees, daysInMonth, pendingChanges, shiftsMap]);

    const pasteClipboardAt = useCallback((targetRow: number, targetCol: number) => {
        pastePlanificacionClipboardAt({
            targetRow,
            targetCol,
            allowPlanningMultiSelect,
            clipboard,
            clipboardIsCut,
            pendingChanges: pendingChangesRef.current,
            displayedEmployees,
            daysInMonth,
            shiftsMap,
            isPlanningDateLocked,
            selectedGrupo,
            grupoUnifiedMode,
            selectedObjective,
            resolveObjectiveForEmp,
            commitPendingChanges,
            setClipboardIsCut,
        });
    }, [allowPlanningMultiSelect, clipboard, clipboardIsCut, commitPendingChanges, displayedEmployees, daysInMonth, shiftsMap, selectedObjective, isPlanningDateLocked, selectedGrupo, grupoUnifiedMode, resolveObjectiveForEmp]);

    const cutSelection = useCallback(() => {
        cutPlanificacionSelection({
            allowPlanningMultiSelect,
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selection,
            displayedEmployees,
            daysInMonth,
            pendingChanges: pendingChangesRef.current,
            shiftsMap,
            isPlanningDateLocked,
            setClipboard,
            setClipboardDim,
            setClipboardIsCut,
            commitPendingChanges,
        });
    }, [allowPlanningMultiSelect, isServiceLocked, activeServiceStatus.msg, selection, commitPendingChanges, displayedEmployees, daysInMonth, shiftsMap, isPlanningDateLocked]);

    // Atajos: Ctrl+C copiar, Ctrl+X cortar, Ctrl+V pegar, Ctrl+Z deshacer
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (mod && key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undoLastPending();
                return;
            }
            if (!allowPlanningMultiSelect && mod && (key === 'c' || key === 'x' || key === 'v')) {
                e.preventDefault();
                toast.message('Cronograma publicado — activá modo Corregir para edición masiva.');
                return;
            }
            if (mod && key === 'c' && selection.start) {
                e.preventDefault();
                const bounds = copySelectionToClipboard(false);
                if (bounds) toast.success(`${bounds.maxR - bounds.minR + 1}×${bounds.maxC - bounds.minC + 1} copiado (Ctrl+V para pegar)`);
                return;
            }
            if (mod && key === 'x' && selection.start) {
                e.preventDefault();
                cutSelection();
                return;
            }
            if (mod && key === 'v' && clipboard && selection.start) {
                e.preventDefault();
                const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r);
                const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
                pasteClipboardAt(minR, minC);
                return;
            }
            if (e.key === 'Escape') {
                setSelection({ start: null, end: null });
                setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [allowPlanningMultiSelect, selection, clipboard, copySelectionToClipboard, cutSelection, pasteClipboardAt, undoLastPending]);

    const handleMouseUp = () => {
        handlePlanificacionMouseUp({
            columnSelectMode,
            isServiceLocked,
            activeServiceStatusMsg: activeServiceStatus.msg,
            selection,
            displayedEmployees,
            daysInMonth,
            rfzByEmpDate,
            selectedObjective,
            selectedGrupo,
            grupoUnifiedMode,
            pendingChanges,
            shiftsMap,
            cellTurnosMap,
            absencesMap,
            empDefaultPos,
            dominantPositionName: dominantPosition.positionName,
            currentDate,
            correctionMode,
            publishStatusMap,
            getObjectiveName,
            isPlanningDateLocked,
            findNeighbors,
            setIsDragging,
            clearLongPressTimer: () => clearTimeout(longPressTimer.current),
            setSelection,
            setActivePosition,
            setSelectedCell,
            setVacancyData,
            setShowVacancyModal,
            setShowConflictModal,
            setModifiers,
            setFrancoMode,
            setCellEditMode,
        });
    };
    const handleMouseDown = (r: number, c: number) => { if (!selectedObjective || comparingSnapshot || isServiceLocked) return; setIsDragging(true); setSelection({ start: {r, c}, end: {r, c} }); };
    const handleMouseEnter = (r: number, c: number) => {
        if (!isDragging || !allowPlanningMultiSelect) return;
        setSelection(prev => ({ ...prev, end: {r, c} }));
    };
    const isCellSelected = (r: number, c: number) => selection.start && r >= Math.min(selection.start.r, selection.end!.r) && r <= Math.max(selection.start.r, selection.end!.r) && c >= Math.min(selection.start.c, selection.end!.c) && c <= Math.max(selection.start.c, selection.end!.c);

    // ── COLUMN SELECT (long press on day header) ──────────────────────────────
    const handleDayHeaderMouseDown = (dayIndex: number) => {
        if (!selectedObjective || comparingSnapshot || isServiceLocked) return;
        if (!allowPlanningMultiSelect) {
            toast.message('Cronograma publicado — activá modo Corregir para selección masiva.');
            return;
        }
        // Segundo clic en la misma fuente: cancela
        if (columnSelectMode && columnSelectSource === dayIndex) {
            setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false);
            setSelection({ start: null, end: null });
            return;
        }
        setColumnSelectMode(true);
        setColumnSelectSource(dayIndex);
        setIsDragging(true);
        setSelection({ start: { r: 0, c: dayIndex }, end: { r: displayedEmployees.length - 1, c: dayIndex } });
    };
    const handleDayHeaderMouseEnter = (dayIndex: number) => {
        if (!allowPlanningMultiSelect || !columnSelectMode || !isDragging) return;
        setSelection(prev => prev.start ? ({ start: prev.start, end: { r: displayedEmployees.length - 1, c: dayIndex } }) : prev);
    };
    const handleDayHeaderMouseUpOrLeave = () => { clearTimeout(longPressTimer.current); };

    // Seleccionar fila completa (click en nombre de empleado)
    const handleRowHeaderClick = (rowIndex: number) => {
        if (!selectedObjective || comparingSnapshot || isServiceLocked || columnSelectMode) return;
        if (!allowPlanningMultiSelect) {
            toast.message('Cronograma publicado — activá modo Corregir para selección masiva.');
            return;
        }
        setSelection({ start: { r: rowIndex, c: 0 }, end: { r: rowIndex, c: daysInMonth.length - 1 } });
    };

    // Copiar selección al clipboard
    const handleCopySelection = () => {
        const bounds = copySelectionToClipboard(false);
        if (bounds) toast.success(`${bounds.maxR - bounds.minR + 1}×${bounds.maxC - bounds.minC + 1} copiado — Ctrl+V para pegar`);
    };

    // Pegar clipboard en posición objetivo
    const handlePasteAt = (targetRow: number, targetCol: number) => {
        pasteClipboardAt(targetRow, targetCol);
    };

    // Importar mes anterior como plantilla (solo celdas vacías)
    const applyPrevMonthTemplate = async () => {
        await applyPlanificacionPrevMonthTemplate({
            selectedObjective,
            currentDate,
            pendingChanges,
            daysInMonth,
            displayedEmployees,
            shiftsMap,
            isPlanningDateLocked,
            setPendingChanges,
            setPrevMonthLoading,
        });
    };


    const loadAbsencesForRange = async (monthStart: Date, monthEnd: Date) =>
        loadPlanificacionAbsencesForRange({
            monthStart,
            monthEnd,
            empresaId,
            scopeEmpresa,
            migracionCompleta,
        });

    const mergeAbsencesFromLocalGrid = (
        absences: Record<string, Map<string, string>>,
        empIds: string[],
        monthStart: Date,
        monthEnd: Date,
    ) => {
        mergePlanificacionAbsencesFromLocalGrid({
            absences,
            empIds,
            monthStart,
            monthEnd,
            selectedObjective,
            shiftsMap,
            pendingChanges,
        });
    };

    /** Viabilidad del cronograma (motor COSP) antes de generar. */
    const generateAutoScheduleV2 = async (): Promise<{ ok: boolean; cycles: string[] }> =>
        generatePlanificacionAutoScheduleV2({
            selectedObjective,
            positionStructure,
            planningDotacionEmployees,
            currentDate,
            daysInMonth,
            clients,
            slaVendidas,
            autoV2BudgetMode,
            autoContingenciaDias,
            autoRotateForce,
            autoAjustarCrono,
            loadAbsencesForRange,
            mergeAbsencesFromLocalGrid,
            setAutoV2Loading,
            setAutoV2Progress,
            setAutoAbsencesMap,
            setAutoContingenciaDias,
            setAutoCycles,
            setAutoV2CoveragePreflight,
            setAutoV2Report,
            setAutoPlanningBrainReport,
            autoPlanningBrainInputRef,
            autoPlanningBrainRef,
            autoSelectedCyclesRef,
            autoV2ReportRef,
        });

    // Flujo completo: detectar esquema → si ok generar; si no ok, mostrar error
    const runFullGeneration = () => {
        setAutoWizardStep('detecting');
        generateAutoScheduleV2()
            .then(({ ok, cycles }) => {
                if (ok) return applyAutoScheduleV2(cycles);
                setAutoWizardStep('verified');
            })
            .catch(() => setAutoWizardStep('configure'));
    };

    // Reset al cerrar el wizard (no auto-ejecutar al abrir)
    useEffect(() => {
        if (!showAutoV2Modal) {
            setAutoWizardStep('configure');
            setAutoWizardPersonalize(true);
            autoV2ReportRef.current = null;
            autoPlanningBrainRef.current = null;
            autoPlanningBrainInputRef.current = null;
            setAutoV2Report(null);
            setAutoPlanningBrainReport(null);
            setAutoV2FormReport(null);
            setAutoRotateForce(null);
            setAutoV2GenStats(null);
            setAutoV2GeminiSummary(null);
            setAutoCoverageGaps([]);
            setPlanCoverageModalGaps([]);
            setCoverageSelectedDays(new Set());
        }
    }, [showAutoV2Modal]);

    /** Paso 4 del agente: ajuste fino Gemini sobre cronograma ya generado + fixer. */
    const runAutoV2PlanningAgentGemini = async (
        finalAssignments: import('@/lib/planificacion/autoScheduleEngineV2').V2Assignment[],
        coverage: import('@/lib/planificacion/coverageVerification').CoverageVerificationReport,
        verifyCtx: import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext,
        stats: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateStats,
        newChanges: Record<string, any>,
        force = false,
        partOfGenerate = false,
    ) =>
        runPlanificacionAutoV2PlanningAgentGemini(
            {
                selectedObjective,
                autoV2RunGemini,
                setAutoV2GeminiLoading,
                setAutoV2Progress,
                currentDate,
                autoV2ReportRef,
                daysInMonth,
                getObjectiveName,
                slaVendidas,
                empresaId,
                setAutoV2GeminiSummary,
            },
            finalAssignments,
            coverage,
            verifyCtx,
            stats,
            newChanges,
            force,
            partOfGenerate,
        );


    /**
     * Genera asignaciones y las vuelca a pendingChanges (motor COSP).
     */
    const applyAutoScheduleV2 = async (cyclesOverride?: string[]) =>
        applyPlanificacionAutoScheduleV2({
            selectedObjective,
            autoV2ReportRef,
            autoSelectedCyclesRef,
            autoCycles,
            setAutoV2Generating,
            setAutoV2Progress,
            currentDate,
            loadAbsencesForRange,
            mergeAbsencesFromLocalGrid,
            planningDotacionEmployees,
            setAutoAbsencesMap,
            empresaId,
            scopeEmpresa,
            migracionCompleta,
            setAutoContingenciaDias,
            daysInMonth,
            setAutoV2CoveragePreflight,
            positionStructure,
            slaVendidas,
            autoPlanningBrainRef,
            autoContingenciaDias,
            displayedEmployees,
            clients,
            empDefaultPos,
            empDefaultShift,
            activeSlaPositionAssignments,
            activeSlaServiceRotations,
            activeSlaServiceRules,
            employees,
            autoV2BudgetMode,
            autoRotateForce,
            autoAjustarCrono,
            setAutoPlanningBrainReport,
            lastGenOpeningRef,
            slaCodeHoursHint,
            authorizedOver200IdsRef,
            planningRules,
            useSixPlusOne,
            autoCoverAbsences,
            setAutoCoverageGaps,
            autoOverwrite,
            pendingChanges,
            shiftsMap,
            setCapOverflowEmps,
            setOver200AuthChecked,
            setOver200AuthPin,
            setOver200AuthError,
            setAutoV2TrailDiag,
            setAutoV2GenStats,
            setAutoV2Coverage,
            setAutoV2Suggestions,
            setAutoV2LastRun,
            runAutoV2PlanningAgentGemini,
            setAutoV2RebalanceLog,
            setAutoV2FormReport,
            setPendingChanges,
            setAutoGeneratedReady,
            setAutoWizardStep,
            setAutoV2Running: () => {},
        }, cyclesOverride);


    /**
     * Reprocesa los errores del reporte de cobertura: swap de descansos rotos
     * contra RETs disponibles, llena slots vacantes con RETs del grupo,
     * resuelve conflictos con licencias. No vuelve a correr el motor entero —
     * sólo opera sobre las celdas que ya generó.
     */
    const reprocessAutoIssues = async () =>
        reprocessPlanificacionAutoIssues({
            autoV2LastRun,
            autoV2Coverage,
            autoOverwrite,
            pendingChanges,
            selectedObjective,
            positionStructure,
            autoPlanningBrainRef,
            setAutoV2Fixing,
            setPendingChanges,
            setAutoV2Coverage,
            setAutoV2Suggestions,
            setAutoV2LastRun,
            setAutoV2FormReport,
        });

    /**
     * Actualiza las métricas de cobertura/SLA cuando se asignan N slots manualmente.
     * extraHours: horas billables adicionales generadas (ej: extensiones D12 = d12Count×4h,
     *             cobertura externa = gaps×8h). Suma a totalBillableHours para cerrar el SLA.
     */
    const applyCoverageToStats = (coveredCount: number, extraHours = 0) =>
        applyPlanificacionCoverageToStats({
            coveredCount,
            extraHours,
            slaVendidas,
            setAutoV2Coverage,
            setAutoV2GenStats,
        });

    /** Rebalanceo manual de forma: swaps trabajo↔F/RET entre guardias (sin F→turno unilateral). */
    const rebalanceAutoForm = async () =>
        rebalancePlanificacionAutoForm({
            autoV2LastRun,
            autoV2Coverage,
            selectedObjective,
            autoOverwrite,
            pendingChanges,
            positionStructure,
            autoPlanningBrainRef,
            setAutoV2Rebalancing,
            setPendingChanges,
            setAutoV2Coverage,
            setAutoV2FormReport,
            setAutoV2RebalanceLog,
            setAutoV2LastRun,
            setAutoV2Suggestions,
            setAutoV2GenStats,
        });

    /** Debug: trae el doc de servicios_sla vigente para el mes en pantalla y lo muestra crudo. */
    const fetchSlaDebug = async () =>
        fetchPlanificacionSlaDebug({
            selectedClient,
            selectedObjective,
            empresaId,
            scopeEmpresa,
            tenantClientIds,
            clients,
            slaIdToObjId,
            currentDate,
            setSlaDebugLoading,
            setSlaDebug,
        });


    const applyColumnCopy = () =>
        applyPlanificacionColumnCopy({
            columnSelectSource,
            selection,
            daysInMonth,
            pendingChanges,
            displayedEmployees,
            shiftsMap,
            selectedObjective,
            setPendingChanges,
            setSelection,
            setColumnSelectMode,
            setColumnSelectSource,
            setIsDragging,
        });

    // 🛑 V8.20: RENDERIZADO DUAL (SPLIT SCREEN) - RESTAURADO
    const calculatePlannedHoursForDate = (dateStr: string) => {
        let total = 0;
        const isWorkingCode = (code: string) => !PLANNING_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        displayedEmployees.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const pending = pendingChanges[key];
            const existing = shiftsMap[key];
            const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
            if (!activeShift) return;
            const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
            if (!shiftObjective || shiftObjective !== selectedObjective) return;
            if (!isWorkingCode(activeShift.code)) return;
            total += calcShiftHours(activeShift);
        });
        return total;
    };

    const monthPlannedHours = useMemo(
        () => daysInMonth.reduce((acc, day) => acc + calculatePlannedHoursForDate(getDateKey(day)), 0),
        [daysInMonth, displayedEmployees, pendingChanges, shiftsMap, selectedObjective]
    );

    const avgHoursPerEmployee = useMemo(() => {
        const isWorkingCode = (code: string) => !PLANNING_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        const empWithHours = new Set<string>();
        let nativePlannedHours = 0;
        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            displayedEmployees.forEach((emp: any) => {
                if (!isEmployeeNativeToObjective(emp)) return;
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (!activeShift) return;
                const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
                if (!shiftObjective || shiftObjective !== selectedObjective) return;
                if (!isWorkingCode(activeShift.code)) return;
                const h = calcShiftHours(activeShift);
                if (h > 0) {
                    empWithHours.add(emp.id);
                    nativePlannedHours += h;
                }
            });
        });
        const count = empWithHours.size;
        if (!count || !nativePlannedHours) return 0;
        return Math.round(nativePlannedHours / count);
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, isEmployeeNativeToObjective]);

    const monthPlannedHoursByPosition = useMemo(() => {
        const map: Record<string, number> = {};
        const isWorkingCode = (code: string) => !PLANNING_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            displayedEmployees.forEach((emp: any) => {
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (!activeShift) return;
                const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
                if (!shiftObjective || shiftObjective !== selectedObjective) return;
                if (!isWorkingCode(activeShift.code)) return;
                const homePos = (activeShift.positionName || dominantPosition?.positionName || 'General').toString();
                const posNames = positionStructure.length > 0
                    ? positionStructure.map((p: any) => String(p.positionName || '').trim()).filter(Boolean)
                    : [homePos];
                for (const posName of posNames) {
                    const h = calcPlanningBillableHoursAttributedToPosition(
                        { ...activeShift, positionName: homePos },
                        posName,
                        slaCodeHoursHint,
                    );
                    if (h > 0) map[posName] = (map[posName] || 0) + h;
                }
            });
        });
        return map;
    }, [daysInMonth, displayedEmployees, pendingChanges, shiftsMap, selectedObjective, dominantPosition, positionStructure, slaCodeHoursHint]);

    const excludedPositionsByDate = useMemo(() => {
        const raw = buildExcludedPositionsByDate(positionStructure);
        const filtered: Record<string, string[]> = {};
        for (const day of daysInMonth) {
            const ds = getDateKey(day);
            if (raw[ds]?.length) filtered[ds] = raw[ds];
        }
        return filtered;
    }, [positionStructure, daysInMonth]);

    const planningEventosCellsByDay = useMemo(() => {
        if (!selectedObjective) return {};
        const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        return buildPlanningEventosCellsByDay(turaMap, shiftsMap, selectedObjective, monthPrefix);
    }, [turaMap, shiftsMap, selectedObjective, currentDate]);

    const hasSlaExcludedDatesInMonth = Object.keys(excludedPositionsByDate).length > 0;

    const planningCompareDiff = useMemo(() => {
        if (!comparingSnapshot?.data || !selectedObjective) return null;
        const histKeys = Object.keys(comparingSnapshot.data);
        const currentSnap = histKeys.length > 0
            ? buildPlanningSnapshotForKeys({
                keys: histKeys,
                shiftsMap,
                pendingChanges,
                objectiveId: selectedObjective,
            })
            : buildPlanningSnapshotFromGrid({
                employeeIds: displayedEmployees.map((e: { id: string }) => e.id),
                dateKeys: daysInMonth.map((d) => getDateKey(d)),
                shiftsMap,
                pendingChanges,
                objectiveId: selectedObjective,
            });
        return diffPlanningSnapshots(comparingSnapshot.data, currentSnap);
    }, [comparingSnapshot, daysInMonth, displayedEmployees, shiftsMap, pendingChanges, selectedObjective]);

    const compareGridEmployees = useMemo(() => {
        if (!comparingSnapshot || !compareShowOnlyDiffs || !planningCompareDiff?.changedKeys.size) {
            return displayedEmployees;
        }
        const ids = new Set<string>();
        for (const key of planningCompareDiff.changedKeys) {
            ids.add(key.split('_')[0]!);
        }
        return displayedEmployees.filter((e: { id: string }) => ids.has(e.id));
    }, [comparingSnapshot, compareShowOnlyDiffs, planningCompareDiff, displayedEmployees]);

    const renderGrid = (
        isSnapshotView: boolean,
        snapshotData?: any,
        compareChangedKeys?: Set<string> | null,
        employeesForRows?: typeof displayedEmployees,
        gridOpts?: { hideFooter?: boolean; compactRows?: boolean; minimalHeader?: boolean; highlightCoverageFooter?: boolean },
    ) => {
        const gridEmployees = employeesForRows ?? displayedEmployees;
        const compareMinimal = !!gridOpts?.minimalHeader;
        const compareCompact = !!gridOpts?.compactRows;
        return (
        <table className="planning-grid-table border-separate border-spacing-0 w-full text-xs">
            <thead className="sticky top-0 z-30 bg-slate-100 shadow-md">
                {compareMinimal ? (
                <tr className="h-7">
                    <th className="planning-sticky-corner bg-slate-100 p-1.5 text-left border-b border-r relative select-none z-20" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <span className="text-[9px] font-black uppercase text-slate-500 flex items-center gap-1">
                            {isSnapshotView ? <History size={10} className="text-amber-600"/> : <Activity size={10} className="text-indigo-600"/>}
                            {isSnapshotView ? 'Histórico' : 'Actual'}
                        </span>
                    </th>
                    {daysInMonth.map((d) => {
                        const dateStr = getDateKey(d);
                        const letter = getDayLetter(dateStr);
                        const isWeekend = [0, 6].includes(d.getDay());
                        return (
                            <th key={`cmp_${d.toISOString()}`} className={`min-w-[22px] border-b border-r p-0 text-center ${isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : ''}`}>
                                <div className={`text-[7px] font-black leading-none ${isWeekend ? 'text-rose-500' : 'text-slate-400'}`}>{letter}</div>
                                <div className={`text-[10px] font-bold leading-none ${isWeekend ? 'text-rose-600' : 'text-slate-700'}`}>{d.getDate()}</div>
                            </th>
                        );
                    })}
                </tr>
                ) : (
                <>
                <tr className="h-6">
                    <th rowSpan={2} className="planning-sticky-corner bg-slate-100 p-2 text-left border-b border-r relative select-none z-20" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <span className="text-[10px] font-black uppercase"><Users size={12}/> Dotación</span>
                        {selectedObjective && !isSnapshotView && (
                            <span className="block text-[8px] font-bold text-slate-400 mt-0.5" title="Total guardias en dotación activa para este objetivo (sin REF/ESC de reserva)">
                                {planningDotacionEmployees.length} c/ turno
                            </span>
                        )}
                        {selectedObjective && !isSnapshotView && staffingReq6x2 && (() => {
                            const avail = planningDotacionEmployees.length;
                            const needed = staffingReq6x2.totalNeeded;
                            const ok = avail >= needed;
                            const tooltip = staffingReq6x2.perPos
                                .map((p: any) => `${p.positionName} (×${p.qty}${p.is24h ? ' 24hs' : ''}): ${p.needed} emp`)
                                .join('\n') + `\nTotal 6+2: ${needed} · Dotación: ${avail}`;
                            return (
                                <span
                                    className={`block text-[8px] font-bold mt-0.5 ${ok ? 'text-emerald-600' : 'text-rose-600'}`}
                                    title={tooltip}
                                >
                                    {ok ? '✓' : '↑'} 6+2: {needed} nec · {avail} asig
                                </span>
                            );
                        })()}
                        {selectedObjective && !isSnapshotView && (
                            activeSlaServiceRotations?.length ? (
                                <div className="relative mt-0.5">
                                    <button
                                        onClick={() => setRotMesDropOpen(p => !p)}
                                        className={`block text-[7px] font-bold leading-tight ${
                                            mesRotacionesDesactivadas.size === (activeSlaServiceRotations as any[]).length
                                                ? 'text-slate-400'
                                                : mesRotacionesDesactivadas.size > 0
                                                    ? 'text-amber-600'
                                                    : 'text-teal-600'
                                        }`}
                                        title="Click para activar/desactivar rotaciones en este mes"
                                    >
                                        ⟳ {(activeSlaServiceRotations as any[]).length - mesRotacionesDesactivadas.size}/{(activeSlaServiceRotations as any[]).length} rot
                                    </button>
                                    {rotMesDropOpen && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setRotMesDropOpen(false)}/>
                                            <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 min-w-[210px]">
                                                <p className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
                                                    Rotaciones · {currentDate.toLocaleString('es', { month: 'long', year: 'numeric' })}
                                                </p>
                                                {(activeSlaServiceRotations as any[]).map(rot => {
                                                    const off = mesRotacionesDesactivadas.has(rot.id);
                                                    return (
                                                        <button
                                                            key={rot.id}
                                                            onClick={() => toggleMesRotacion(rot.id)}
                                                            className="w-full px-3 py-2 text-left text-[11px] font-semibold flex items-center gap-2 hover:bg-slate-50 transition-colors"
                                                        >
                                                            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${off ? 'border-slate-300 bg-white' : 'border-teal-500 bg-teal-500'}`}>
                                                                {!off && <span className="text-white text-[9px] font-black">✓</span>}
                                                            </span>
                                                            <span className={off ? 'text-slate-400 line-through' : 'text-slate-700'}>{rot.name || rot.id}</span>
                                                        </button>
                                                    );
                                                })}
                                                <div className="h-px bg-slate-100 mx-2 my-1"/>
                                                <button
                                                    onClick={() => { toggleTodasMesRotaciones(mesRotacionesDesactivadas.size < (activeSlaServiceRotations as any[]).length); setRotMesDropOpen(false); }}
                                                    className="w-full px-3 py-1.5 text-left text-[10px] font-bold text-slate-500 hover:bg-slate-50 flex items-center gap-2"
                                                >
                                                    {mesRotacionesDesactivadas.size < (activeSlaServiceRotations as any[]).length ? '⊘ Desactivar todas' : '✓ Activar todas'}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <span className="block text-[7px] font-bold mt-0.5 text-slate-400">⟳ —</span>
                            )
                        )}
                        {hasSlaExcludedDatesInMonth && !isSnapshotView && (
                            <span className="block text-[7px] font-bold text-rose-500 mt-1 leading-tight" title="En el número del día aparece el puesto excluido (Servicios → Días excluidos)">
                                ⊘ = sin servicio SLA
                            </span>
                        )}
                        <div
                            className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/60 transition-colors"
                            title="Arrastrar para cambiar el ancho"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                nameColResizing.current = { startX: e.clientX, startW: nameColWidth };
                                const onMove = (ev: MouseEvent) => {
                                    if (!nameColResizing.current) return;
                                    setNameColWidth(Math.max(120, Math.min(400, nameColResizing.current.startW + ev.clientX - nameColResizing.current.startX)));
                                };
                                const onUp = () => {
                                    nameColResizing.current = null;
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                            }}
                        />
                    </th>
                    {daysInMonth.map((d) => {
                        const dateStr = getDateKey(d);
                        const letter = getDayLetter(dateStr);
                        const isWeekend = [0, 6].includes(d.getDay());
                        const excludedNames = excludedPositionsByDate[dateStr];
                        const hasExclusion = !!excludedNames?.length;
                        return (
                            <th key={`dw_${d.toISOString()}`} className={`min-w-[25px] border-b border-r p-1 text-center ${hasExclusion ? 'border-t-2 border-t-rose-400' : isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'dark:border-slate-700'}`}
                                title={hasExclusion ? excludedPositionsTooltip(excludedNames, dateStr) : undefined}>
                                <span className={`text-[9px] font-black ${hasExclusion ? 'text-rose-600 dark:text-rose-400' : isWeekend ? 'text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{letter}</span>
                            </th>
                        );
                    })}
                </tr>
                <tr className={hasSlaExcludedDatesInMonth ? 'h-11' : 'h-10'}>
                    {daysInMonth.map((d, dayIndex) => {
                        const dateStr = getDateKey(d);
                        const isSource = columnSelectMode && columnSelectSource === dayIndex;
                        const isInSel = !isSnapshotView && selection.start != null && dayIndex >= Math.min(selection.start.c, selection.end?.c ?? selection.start.c) && dayIndex <= Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
                        const isWeekend = [0,6].includes(d.getDay());
                        const excludedNames = excludedPositionsByDate[dateStr];
                        const hasExclusion = !!excludedNames?.length;
                        const exTitle = hasExclusion ? excludedPositionsTooltip(excludedNames, dateStr) : undefined;
                        const isHeaderPastPublished = (dateStr < getDateKey(new Date())) && !!selectedObjective && isPlanificacionPublished(publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)]);
                        return (
                            <th
                                key={d.toISOString()}
                                onMouseDown={() => !isSnapshotView && handleDayHeaderMouseDown(dayIndex)}
                                onMouseEnter={() => !isSnapshotView && handleDayHeaderMouseEnter(dayIndex)}
                                onMouseUp={handleDayHeaderMouseUpOrLeave}
                                onMouseLeave={handleDayHeaderMouseUpOrLeave}
                                className={`min-w-[25px] border-b-2 border-r p-0.5 text-center select-none cursor-pointer transition-colors
                                    ${isSource ? 'bg-indigo-600 text-white' : isInSel && columnSelectMode ? 'bg-indigo-100 dark:bg-indigo-900/40' : hasExclusion ? 'bg-rose-100/90 dark:bg-rose-950/40 border-b-rose-300 dark:border-rose-800' : isHeaderPastPublished ? 'bg-slate-200/80 dark:bg-slate-700/60 border-b-slate-300 dark:border-slate-600' : isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-700 dark:border-slate-700 border-b-slate-200'}`}
                                title={columnSelectMode ? (isSource ? 'Clic para cancelar copia' : 'Clic para extender destino') : exTitle || 'Clic para copiar este día'}
                            >
                                <span className={`text-[10px] font-bold leading-none ${isSource ? 'text-white' : hasExclusion ? 'text-rose-800 dark:text-rose-200 font-black' : isWeekend ? 'text-rose-600 dark:text-rose-400 font-black' : 'dark:text-slate-300'}`}>{d.getDate()}</span>
                                {hasExclusion && !isSource && (
                                    <div className="text-[6px] font-black text-rose-700 dark:text-rose-300 leading-tight mt-0.5 truncate max-w-[26px] mx-auto px-0.5" title={exTitle}>
                                        ⊘ {excludedPositionsCellLabel(excludedNames)}
                                    </div>
                                )}
                                {isSource && <div className="text-[7px] font-black opacity-80 leading-none mt-0.5">ORIG</div>}
                            </th>
                        );
                    })}
                </tr>
                </>
                )}
            </thead>
            <tbody>
                {gridEmployees.map((emp, idx) => {
                    const isGuest = selectedObjective && (
                        (selectedGrupo && grupoUnifiedMode)
                            ? !(selectedGrupo.objectiveIds.includes(emp.preferredObjectiveId) ||
                                (slaIdToObjId[emp.preferredObjectiveId] && selectedGrupo.objectiveIds.includes(slaIdToObjId[emp.preferredObjectiveId])))
                            : emp.preferredObjectiveId !== selectedObjective
                    );
                    const isVolante = isGuest && selectedObjective && (emp.volante || []).includes(selectedObjective);
                    const homeObjectiveName = getObjectiveName(emp.preferredObjectiveId);
                    const isPoolRow = !!emp._fromDotacionPool;
                    const showPoolDivider = isPoolRow && (idx === 0 || !gridEmployees[idx - 1]?._fromDotacionPool);
                    
                    return (
                        <React.Fragment key={emp.id}>
                            {showPoolDivider && !isSnapshotView && (
                                <tr className="no-print">
                                    <td
                                        colSpan={1 + daysInMonth.length}
                                        className="sticky left-0 z-20 bg-amber-100 border-y border-amber-200 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-800"
                                    >
                                        Candidatos {dotacionPoolType === 'RET' ? 'RET' : dotacionPoolType === 'F' ? 'franco' : dotacionPoolType === 'LIBRE' ? 'sin turno' : ''} ≤{nearbyKmRadius} km — asigná en esta grilla
                                    </td>
                                </tr>
                            )}
                            {!isSnapshotView && (
                                <tr
                                    id={`plan-emp-${emp.id}`}
                                    className={`group ${isPoolRow ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''} ${highlightEmpId === emp.id ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : ''} ${dragOverVisual === idx ? 'border-t-2 border-t-indigo-400' : ''} ${(empMonthlyHours[emp.id] || 0) >= planningLimits.monthly ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                                    onDragOver={(e) => handleRowDragOver(e, idx)}
                                    onDrop={(e) => handleRowDrop(e, idx)}
                                    onDragEnd={() => setDragOverVisual(null)}
                                >
                                    <td
                                        draggable
                                        onDragStart={(e) => handleRowDragStart(e, idx)}
                                        onClick={() => !isSnapshotView && handleRowHeaderClick(idx)}
                                        title="Clic para seleccionar fila completa"
                                        style={{ width: nameColWidth, minWidth: nameColWidth }}
                                        className={`sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 cursor-grab active:cursor-grabbing dark:border-slate-700 ${(empMonthlyHours[emp.id] || 0) >= planningLimits.monthly ? 'bg-red-50 group-hover:bg-red-100 dark:bg-red-950/30 dark:group-hover:bg-red-900/30' : 'bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/60'}`}
                                    >
                                        {(() => {
                                            if (compareCompact) {
                                                return (
                                                    <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                                );
                                            }
                                            const objLat = Number(selectedObjectiveData?.lat ?? 0);
                                            const objLng = Number(selectedObjectiveData?.lng ?? 0);
                                            const distKm = employeeKmToObjective(emp, objLat, objLng);
                                            const monthHours = empMonthlyHours[emp.id] || 0;
                                            const cctHours = empCctCurrentHours[emp.id] || 0;
                                            const retDays = empRetDays[emp.id] || 0;
                                            const displayHours = hoursMode === 'cct' ? cctHours : monthHours;
                                            const formatLegajoHours = (h: number) => {
                                                const r = Math.round(h * 10) / 10;
                                                return Number.isInteger(r) ? String(r) : r.toFixed(1);
                                            };
                                            const hoursColor = displayHours >= planningLimits.monthly ? 'text-red-600 font-black'
                                                : displayHours >= 185 ? 'text-orange-500 font-bold'
                                                : displayHours >= 160 ? 'text-amber-500'
                                                : displayHours > 0   ? 'text-slate-500 dark:text-slate-300'
                                                : retDays > 0          ? 'text-amber-800 font-bold'
                                                : 'text-slate-400 dark:text-slate-500';
                                            return (
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                                        <Grip size={8} className="shrink-0 text-slate-200 group-hover:text-slate-400 transition-colors mr-0.5" />
                                                        <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                                        {isVolante && (<div className="shrink-0 px-1.5 py-0.5 rounded bg-violet-500 text-white text-[8px] font-black uppercase flex items-center gap-1 cursor-help shadow-sm" title={`Volante — base: ${homeObjectiveName}`}><Shuffle size={8} /> VOL</div>)}
                                        {isGuest && !isVolante && (<div className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[8px] font-black uppercase flex items-center gap-1 cursor-help shadow-sm" title={`Base: ${homeObjectiveName}`}><Briefcase size={8} /> {emp._kind || 'EXT'}</div>)}
                                                        {selectedGrupo && grupoUnifiedMode && (() => {
                                                            const _native = selectedGrupo.objectiveIds.includes(emp.preferredObjectiveId)
                                                                ? emp.preferredObjectiveId
                                                                : (slaIdToObjId[emp.preferredObjectiveId] && selectedGrupo.objectiveIds.includes(slaIdToObjId[emp.preferredObjectiveId]) ? slaIdToObjId[emp.preferredObjectiveId] : null);
                                                            if (!_native) return null;
                                                            const _oi = selectedGrupo.objectiveIds.indexOf(_native);
                                                            const _clr = GRUPO_COLOR_HEX[_oi % GRUPO_COLOR_HEX.length];
                                                            const _nm = (selectedGrupo.objectiveNames[_oi] || '').trim().split(/\s+/).filter((w: string) => w.length > 1).pop()?.slice(0, 6).toUpperCase() || '';
                                                            return <div className="shrink-0 px-1 py-0.5 rounded text-[7px] font-black text-white leading-tight cursor-help" style={{ backgroundColor: _clr }} title={selectedGrupo.objectiveNames[_oi]}>{_nm}</div>;
                                                        })()}
                                                        {/* Horas mensuales planificadas (facturables) + días RET sobrantes */}
                                                        <span
                                                            title={hoursMode === 'cct'
                                                                ? `${formatLegajoHours(cctHours)}h en el ciclo CCT actual (26 mes anterior → 25 de este mes). Tope 200h.\n${formatLegajoHours(monthHours)}h en el mes calendario.${retDays > 0 ? `\n${retDays} días RET (0 h planificadas; sobrante disponible en otro objetivo).` : ''}`
                                                                : `${formatLegajoHours(monthHours)}h facturables en el mes (= Pre-factura). Días 🚫 sin servicio SLA no suman aunque veas el código en la celda.\n${formatLegajoHours(cctHours)}h en el ciclo CCT actual (tope 200h).${retDays > 0 ? `\n${retDays} días RET (0 h planificadas; sobrante disponible en otro objetivo).` : ''}`}
                                                            className={`shrink-0 text-[8px] ${hoursColor}`}
                                                        >
                                                            {formatLegajoHours(displayHours)}h
                                                            {retDays > 0 && displayHours === 0 && <span className="ml-0.5 text-[7px] text-amber-700 font-bold" title={`${retDays} días RET (0 h planificadas)`}>+{retDays}RET</span>}
                                                            {hoursMode === 'cct' && <span className="ml-0.5 text-[7px] text-indigo-500 font-black">CCT</span>}
                                                        </span>
                                                        {/* Distancia al objetivo — solo si hay coordenadas */}
                                                        {distKm !== null ? (
                                                            <span title="Distancia al objetivo" className={`shrink-0 flex items-center gap-0.5 text-[8px] ${distKm >= 9 ? 'text-orange-500' : distKm >= 3 ? 'text-amber-400' : 'text-slate-400 dark:text-slate-400'}`}>
                                                                <MapPin size={7}/>{distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`}
                                                            </span>
                                                        ) : emp.address ? (
                                                            <span title="Sin coordenadas — ir a RRHH y geolocalizar" className="shrink-0 flex items-center gap-0.5 text-[8px] text-amber-400 opacity-60 group-hover:opacity-100">
                                                                <MapPin size={7}/>?
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex gap-1 ml-1 shrink-0 items-center">
                                                        {positionStructure.length > 1 && !isServiceLocked && (
                                                            <button
                                                                draggable={false}
                                                                data-emp-pos-btn={emp.id}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (empPosPicker?.empId === emp.id) setEmpPosPicker(null); else openEmpPosPickerAt(emp.id, e.currentTarget as HTMLElement); }}
                                                                className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-colors whitespace-nowrap ${
                                                                    isDeploymentSurplusCode(getEmpDefaultShift(emp.id))
                                                                        ? (getEmpDefaultShift(emp.id) === 'ESC' ? 'bg-sky-600 text-white' : 'bg-violet-600 text-white')
                                                                        : getEmpDefaultPos(emp.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100'
                                                                }`}
                                                                title={`Puesto: ${getEmpDefaultPos(emp.id) || 'sin asignar'} · Rol: ${getEmpDefaultShift(emp.id) || 'auto'}${isEmpExcludedFromPlanningDotacion(emp, selectedObjective) ? ' (excluido de auto/dotación)' : ''}`}
                                                            >
                                                                {(() => {
                                                                    const sc = getEmpDefaultShift(emp.id);
                                                                    if (sc === 'REF' || sc === 'ESC') return `${sc} · ${getEmpDefaultPos(emp.id) || '·'}`;
                                                                    if (sc) return sc;
                                                                    return getEmpDefaultPos(emp.id) || '···';
                                                                })()}
                                                            </button>
                                                        )}
                                                        {!isSnapshotView && selectedObjective && !isServiceLocked && (
                                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                {!isGuest && (<button onClick={(e) => { e.stopPropagation(); handleUnassignEmployee(emp); }} className="p-1 hover:bg-rose-100 text-rose-400 hover:text-rose-600 rounded transition-all" title="Desvincular"><UserMinus size={12}/></button>)}
                                                                {isGuest && (<button onClick={(e) => { e.stopPropagation(); handleTransferEmployee(emp); }} className="p-1 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 rounded transition-all" title="Transferir a este Objetivo"><UserCheck size={12}/></button>)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    {daysInMonth.map((day, dayIndex) => {
                                        const cellDateStr = getDateKey(day);
                                        const key = `${emp.id}_${cellDateStr}`;
                                        const { s, p } = resolveCellShiftDisplay(
                                            emp.id, cellDateStr, selectedObjective, selectedGrupo, grupoUnifiedMode, pendingChanges, shiftsMap, cellTurnosMap,
                                        );
                                        const rfzOnCell = rfzByEmpDate[key];
                                        const selected = !isSnapshotView && isCellSelected(idx, dayIndex);
                                        const isLockedDate = !isSnapshotView && isPlanningDateLocked(getDateKey(day));
                                        const isCellWeekend = [0, 6].includes(day.getDay());
                                        const isPastDay = cellDateStr < getDateKey(new Date());
                                        let content = null; let style = "";
                                        let isFT = s?.isFrancoTrabajado || p?.isFrancoTrabajado; let isFF = s?.isFrancoCompensatorio || p?.isFrancoCompensatorio;
                                        let isExtended = s?.isExtended || p?.isExtended || s?.isRetention || p?.isRetention;
                                        let isEarly = s?.isEarlyStart || p?.isEarlyStart; 
                                        const covRole = p?.coverageSegmentRole || s?.coverageSegmentRole;
                                        const covNote = p?.coverageNote || s?.coverageNote;
                                        let plannedNov = s?.plannedNovedad || p?.plannedNovedad; 
                                        let absence = absencesMap[key];
                                        if (absence && ((absence.inferredCode as string) || inferAbsenceCode(absence)) === 'AA' && !isPlanificacionPublished(publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)])) absence = null as any;
                                        const effectiveCode = p?.code || s?.code;
                                        const coveredByCell = p?.coveredBy || s?.coveredBy || s?.coveredByEmployeeName || p?.coveredByEmployeeName;
                                        let hasConflict = shouldShowLeaveConflictSiren({
                                            shiftCode: effectiveCode,
                                            absence,
                                            coveredBy: coveredByCell,
                                            hasNovedad: !!(s && s.hasNovedad),
                                            shiftStatus: s?.status,
                                        });
                                        let statusIndicator = null;
                                        const _planPublished = isPlanificacionPublished(publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)]);
                                        const isPastAndPublished = _planPublished && isPastDay;
                                        if (s && !isSnapshotView) {
                                            const _codeU = String(s.code || effectiveCode || '').toUpperCase();
                                            const _passiveStandby = _codeU === 'RET' || s.isReten === true;
                                            // RET stand-by: no punto verde fantasma. ESC/REF sí pueden estar presentes.
                                            // Solo turno real (M/T/N/…) o cobertor ya convertido muestra presencia.
                                            if (!_passiveStandby) {
                                                if (s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isPresent) statusIndicator = 'bg-emerald-500';
                                                else if (s.status === 'ABSENT' || s.isAbsent) statusIndicator = 'bg-rose-500';
                                            } else if (s.status === 'ABSENT' || s.isAbsent) {
                                                statusIndicator = 'bg-rose-500';
                                            }
                                        }
                                        let isSwap = s?.swapWith || p?.swapWith;
                                        const swapPending = !!(
                                            isSwap &&
                                            (
                                                (s?.origin && s.origin !== 'PLANIFICADOR' && !s.swapAuthorized) ||
                                                (p?.origin && p.origin !== 'PLANIFICADOR' && !p.swapAuthorized)
                                            )
                                        );
                                        const swapStyle = swapPending ? SHIFT_STYLES['SWAP_PENDING'] : SHIFT_STYLES['SWAP'];
                                        if (isLockedDate && !p) { style = SHIFT_STYLES['PAST']; if (s) content = s.code; }
                                        else if (p) { if(p.isDeleted) { content=<X size={12}/>; style="bg-rose-50 text-rose-300"; } else { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { content=p.code; const baseStyle = SHIFT_STYLES[p.code]; style = baseStyle ? `${baseStyle} ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}` : `bg-amber-100 text-amber-700 font-black ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}`; if (content === 'REF' || content === 'ESC') content = cellLabelForDeployment(String(content), p.deploymentBand); } } }
                                        else if (s) { if (!isLockedDate) { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { style=`${getDefaultStyle(s.code)} ${isSwap ? swapStyle : ''}`; content=s.code; } } }
                                        else if (rfzOnCell && !p) {
                                            content = 'RFZ';
                                            style = `${SHIFT_STYLES['RFZ']}${rfzOnCell.draft ? ' ring-2 ring-amber-400' : ''}`;
                                        }
                                        const _deployBand = (p && !p.isDeleted ? p.deploymentBand : s?.deploymentBand);
                                        if (content === 'REF' || content === 'ESC') {
                                            content = cellLabelForDeployment(String(content), _deployBand);
                                        }
                                        if (plannedNov === 'AVISO') { style += ' border-l-4 border-l-amber-500'; }
                                        if (plannedNov === 'LICENCIA') { style += ' border-l-4 border-l-purple-500'; }
                                        if (content === 'Ausencia con Aviso' || content === 'Injustificada') { content = 'AA'; style = SHIFT_STYLES['AA']; }
                                        const _isRaCell = !!(
                                            (p && !p.isDeleted && p.isRetiroAnticipado)
                                            || (s && s.isRetiroAnticipado)
                                        );
                                        if (_isRaCell && content != null && typeof content === 'string' && !String(content).includes('/RA')) {
                                            content = `${String(content).toUpperCase()}/RA`;
                                            style += ' ring-1 ring-rose-400';
                                        }
                                        if (isGuest && (s || p)) { style += ' border-t-2 border-t-amber-400'; }
                                        const activeShift = (p && !p.isDeleted) ? p : (s || (rfzOnCell ? rfzDocToShiftView(rfzOnCell) : null));
                                        // TURA: turno agregado por cliente → fondo rojo en celda padre
                                        if (activeShift?.id && turaMap[activeShift.id]) { style = 'bg-red-500 text-white border-red-600 font-black'; }
                                        const hasRfzOverlay = !!(rfzOnCell && (s || (p && !p.isDeleted)) && !absence);
                                        const _rawOtherObj = isShiftAtOtherObjective(s, p, selectedObjective);
                                        const _activeShiftObjId = ((p && !p.isDeleted) ? p : s)?.objectiveId;
                                        const _cellIsRetAtOtherObj = _rawOtherObj && shiftPlanningCodeUpper(activeShift) === 'RET';
                                        const isOtherObjectiveShift = _rawOtherObj
                                            && !_cellIsRetAtOtherObj
                                            && !(selectedGrupo && grupoUnifiedMode && selectedGrupo.objectiveIds.includes(_activeShiftObjId));
                                        if (absence) { const absCode = absence.inferredCode || inferAbsenceCode(absence); const displayCode = absenceGridDisplayCode(absence); content = displayCode; style = SHIFT_STYLES[displayCode] || SHIFT_STYLES[absCode] || 'bg-rose-50 text-rose-700 font-bold border-rose-200'; }
                                        if (isOtherObjectiveShift && content != null) {
                                            style = OTHER_OBJECTIVE_CELL_STYLE;
                                        }
                                        if (_cellIsRetAtOtherObj && content != null) {
                                            style = `${SHIFT_STYLES['RET']} ring-1 ring-amber-400/80`;
                                        }
                                        const isCoverageSplitCell = !!(
                                            !isFT
                                            && !isFF
                                            && !absence
                                            && !isOtherObjectiveShift
                                            && content != null
                                            && !(activeShift?.id && turaMap[activeShift.id])
                                            && (
                                                isExtended
                                                || isEarly
                                                || covRole === 'EXTENSION'
                                                || covRole === 'EARLY_START'
                                            )
                                        );
                                        if (isCoverageSplitCell) {
                                            style = `${SHIFT_STYLES['EXTENDED']} z-10`;
                                        }
                                        const isOpsCovCell = !!(
                                            !absence
                                            && !isOtherObjectiveShift
                                            && content != null
                                            && !(activeShift?.id && turaMap[activeShift.id])
                                            && isOpsCoverageShift(activeShift)
                                        );
                                        if (isOpsCovCell) {
                                            style = `${SHIFT_STYLES['OPS_COV']} z-10`;
                                        }
                                        if (compareChangedKeys?.has(key)) {
                                            style += isSnapshotView
                                                ? ' ring-2 ring-amber-600 ring-offset-1 z-20'
                                                : ' ring-2 ring-violet-600 ring-offset-1 z-20';
                                        }
                                        const cellPosName = (p && !p.isDeleted ? p.positionName : s?.positionName) || rfzOnCell?.positionName || null;
                                        const cellCode = (p && !p.isDeleted) ? (isFT ? 'FT' : isFF ? 'FF' : p.code) : s ? (isFT ? 'FT' : isFF ? 'FF' : s.code) : (rfzOnCell ? 'RFZ' : null);
                                        const _cellShift = (p && !p.isDeleted) ? p : s;
                                        const _cellCodeForRange = String(cellCode || '').toUpperCase();
                                        const _cellActualRange = (_cellShift && _cellCodeForRange)
                                            ? (() => {
                                                const label = formatShiftScheduleLabel(_cellShift, _cellCodeForRange);
                                                return label && label !== '—' ? label : null;
                                            })()
                                            : null;
                                        const _b2 = resolveCellSecondBlock(
                                            key,
                                            pendingChanges,
                                            secondBlockMap,
                                            cellPosName,
                                            cellCode,
                                            positionStructure,
                                        );
                                        const _b2Range = (_b2?.startTime && _b2?.endTime)
                                            ? `${formatTime(_b2.startTime)} - ${formatTime(_b2.endTime)}`
                                            : null;
                                        const cellRange = cellCode
                                            ? ((_cellActualRange && _b2Range)
                                                ? `${_cellActualRange} + ${_b2Range}`
                                                : (_cellActualRange || SHIFT_RANGES[cellCode] || null))
                                            : null;
                                        const excludedOnDay = excludedPositionsByDate[cellDateStr];
                                        const isExclusionCol = !!excludedOnDay?.length;
                                        const cellPosExcluded = !!(cellPosName && excludedOnDay?.includes(cellPosName));
                                        const leaveCellCode = absence
                                            ? String(absenceGridDisplayCode(absence) || content || '').toUpperCase()
                                            : String(cellCode || '').toUpperCase();
                                        const isLeaveCell = !!absence || LEAVE_CELL_CODES.has(leaveCellCode);
                                        const _covSegHint = isEarly || covRole === 'EARLY_START'
                                            ? '\n⏩ Adelanto (cobertura)'
                                            : (isExtended || covRole === 'EXTENSION')
                                                ? '\n⏱ Extensión (cobertura)'
                                                : '';
                                        const _opsCovName = activeShift?.coversAbsenceEmployeeName
                                            || activeShift?.absenceEmployeeName
                                            || activeShift?.coveredEmployeeName
                                            || '';
                                        const _opsCovHint = isOpsCovCell
                                            ? `\n🟠 Cobertura ops${_opsCovName ? ` — cubre: ${_opsCovName}` : ''}`
                                            : '';
                                        const _opsAbsent = !!(s && !absence && (s.status === 'ABSENT' || s.isAbsent));
                                        const _gridCoveredName = (isLeaveCell || _opsAbsent)
                                            ? resolveTitularCoverageName(emp.id, emp.name || '', cellDateStr, shiftsMap, pendingChanges, (id) => employees.find((x: any) => x.id === id)?.name, coveredByCell, cellTurnosMap, selectedObjective, cellPosName, cellCode)
                                            : null;
                                        const _gridCoveredLabel = _gridCoveredName
                                            ? String(_gridCoveredName).split(',')[0].trim().split(/\s+/)[0].slice(0, 7)
                                            : null;
                                        const _covererLabel = _opsCovName
                                            ? String(_opsCovName).split(',')[0].trim().split(/\s+/)[0].slice(0, 7)
                                            : null;
                                        const _opsAbsentCovered = _opsAbsent ? _gridCoveredName : null;
                                        const _opsAbsentHint = _opsAbsent
                                            ? `\n🔴 Ausente operativo${_opsAbsentCovered ? ` · Cubierto por: ${_opsAbsentCovered}` : ' · Sin cobertura nominal'}`
                                            : '';
                                        const _segCoverHint = (isEarly || isExtended || isCoverageSplitCell) && _opsCovName
                                            ? `\n🔗 Cubre a: ${_opsCovName}`
                                            : ((isEarly || covRole === 'EARLY_START')
                                                ? '\n⚠ Adelanto ≠ +24h; horario de banda si timestamps 00:00'
                                                : '');
                                        const _covHint = (covNote ? `\n📋 ${covNote}` : '') + _covSegHint + _opsCovHint + _opsAbsentHint + _segCoverHint;
                                        const _billBr = activeShift && shiftCountsForEmployeeCronoHours(activeShift)
                                            ? planningShiftBillableBreakdown(activeShift, slaCodeHoursHint)
                                            : null;
                                        const _billHint = _billBr && _billBr.gross > 0
                                            ? `\n📊 ${_billBr.base}h base${_billBr.extra > 0 ? ` + ${_billBr.extra}h cobertura = ${_billBr.gross}h` : ` (${_billBr.gross}h)`}`
                                            : '';
                                        return <td key={key} onMouseDown={() => !isSnapshotView && handleMouseDown(idx, dayIndex)} onMouseEnter={(e) => { if (!isSnapshotView && isDragging && allowPlanningMultiSelect) setSelection(pr => ({...pr, end:{r:idx, c:dayIndex}})); if (isLeaveCell) { const absType = absence?.type || activeShift?.name || LEGEND_DESCRIPTIONS[leaveCellCode] || leaveCellCode; const reason = absence?.reason || activeShift?.comments || p?.comments || ''; const covered = resolveTitularCoverageName(emp.id, emp.name || '', cellDateStr, shiftsMap, pendingChanges, (id) => employees.find((x: any) => x.id === id)?.name, coveredByCell, cellTurnosMap, selectedObjective, cellPosName, cellCode); const leaveTrace = buildPlanningCellTrace({ role: 'titular', titularName: emp.name || '', dateStr: cellDateStr, plannedCode: cellCode, plannedSchedule: cellRange, plannedPosition: cellPosName, absenceType: absType, absenceReason: reason, isOpsAbsent: !!(s && (s.isAbsent || s.status === 'ABSENT')), coveredByName: covered, vacancyOpen: !covered }); setShiftTooltip({ label: formatPlanningTraceTooltip(leaveTrace), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else if ((s || p || rfzOnCell) && !absence) { const shiftLabel = (cellCode === 'EV' && (activeShift?.eventoNombre || activeShift?.servicioNombre))
                                                    ? [activeShift?.eventoNombre, activeShift?.servicioNombre].filter(Boolean).join(' · ')
                                                    : cellCode ? (LEGEND_DESCRIPTIONS[cellCode] || cellCode) : (rfzOnCell ? 'Refuerzo cliente (RFZ)' : null); const _isFrancoTip = cellCode ? ['F','FF','FP','FT'].includes(String(cellCode).toUpperCase()) : false; const _restHrs = _isFrancoTip ? calcFrancoRestHours(emp.id, dayIndex) : null; const _isRet = String(cellCode || '').toUpperCase() === 'RET'; const _exclHint = cellPosExcluded ? `\n⚠ Puesto excluido por SLA este día` : ''; const _otherObjHint = isOtherObjectiveShift && activeShift?.objectiveId ? `\n📍 Otro objetivo: ${getObjectiveName(activeShift.objectiveId)}` : ''; const _rfzHint = rfzOnCell ? `\n🔴 RFZ ${formatTime(rfzOnCell.startTime)}–${formatTime(rfzOnCell.endTime)}${rfzOnCell.positionName ? ` · ${rfzOnCell.positionName}` : ''}` : ''; const _linkedTura = activeShift?.id ? turaMap[activeShift.id] : null; const _turaHint = _linkedTura ? `\n🟣 TURA ${isTuraContiguousToParent(activeShift, _linkedTura) ? 'seguido' : 'cortado'} ${formatShiftClockRange(_linkedTura)}${_linkedTura.positionName ? ` → ${_linkedTura.positionName}` : ''}` : ''; setShiftTooltip({ label: shiftLabel ? `${shiftLabel}${_exclHint}${_otherObjHint}${_rfzHint}${_turaHint}${_covHint}${_billHint}` : (_exclHint || _otherObjHint || _rfzHint || _turaHint || _covHint || _billHint || null), pos: _isRet ? null : (cellPosName || rfzOnCell?.positionName || null), range: _isRet ? null : (cellRange || (rfzOnCell ? `${formatTime(rfzOnCell.startTime)} - ${formatTime(rfzOnCell.endTime)}` : null)), x: e.clientX, y: e.clientY, restHours: _restHrs }); } else if (isExclusionCol) { setShiftTooltip({ label: excludedPositionsTooltip(excludedOnDay, cellDateStr), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else setShiftTooltip(null); }} onMouseLeave={() => setShiftTooltip(null)} className={`border-b border-r p-0.5 ${!isSnapshotView && !isLockedDate && !isServiceLocked ? 'cursor-pointer' : 'cursor-default'} text-center relative ${selected ? 'bg-indigo-200 dark:bg-indigo-800/50' : isExclusionCol ? 'bg-rose-50/50 dark:bg-rose-950/15 sla-excluded-day-col' : isPastAndPublished ? (isCellWeekend ? 'bg-slate-200/50 dark:bg-slate-700/40' : 'bg-slate-100/80 dark:bg-slate-800/50') : isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`} title={isExclusionCol && !s && !p ? excludedPositionsTooltip(excludedOnDay, cellDateStr) : isOtherObjectiveShift && activeShift?.objectiveId ? `Turno en ${getObjectiveName(activeShift.objectiveId)}` : undefined}><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style} ${cellPosExcluded ? 'ring-1 ring-rose-400/70' : ''}`}>{content}{isExclusionCol && !content && (<span className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-full bg-rose-400/80" title="Día con puesto(s) excluido(s)"/>)}{isSwap && (<div className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${swapPending ? 'bg-amber-600 text-white' : 'bg-cyan-600 text-white'}`}>{swapPending ? 'S!' : 'S'}</div>)}{(isExtended || isEarly || isCoverageSplitCell) && <div className="absolute -top-1 -right-1 text-[8px] bg-red-900 text-white px-1 rounded-full border border-white/40">+</div>}{(isLeaveCell || _opsAbsent) ? (
                                                        <div
                                                            className={`absolute -bottom-0.5 left-0 right-0 text-[5px] font-black px-0.5 rounded truncate leading-tight ${
                                                                _gridCoveredLabel
                                                                    ? 'bg-orange-600 text-white'
                                                                    : 'bg-rose-700 text-white'
                                                            }`}
                                                            title={
                                                                _gridCoveredName
                                                                    ? `Ausente → cubierto por ${_gridCoveredName}`
                                                                    : 'Ausente · sin cobertura nominal'
                                                            }
                                                        >
                                                            {_gridCoveredLabel ? `→${_gridCoveredLabel}` : 'SIN COV'}
                                                        </div>
                                                    ) : (_opsCovName || isOpsCovCell || isCoverageSplitCell || isEarly || isExtended) ? (
                                                        <div
                                                            className="absolute -bottom-0.5 left-0 right-0 text-[5px] font-black bg-amber-800/90 text-white px-0.5 rounded truncate leading-tight"
                                                            title={_opsCovName ? `Cubre a: ${_opsCovName}` : (isEarly ? 'Adelanto (cobertura) — no es +24h' : isExtended ? 'Extensión (cobertura)' : 'Cobertura operativa')}
                                                        >
                                                            {_covererLabel ? `cubre ${_covererLabel}` : (isEarly ? 'ADEL+' : isExtended ? 'EXT+' : 'COV')}
                                                        </div>
                                                    ) : null}{covRole === 'LIBERATED' && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-emerald-600 text-white px-0.5 rounded">RET</div>}{statusIndicator && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${statusIndicator}`}></div>}{hasConflict && ( <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center animate-pulse border-2 border-red-500 z-20"><Siren size={14} className="text-white drop-shadow-md"/></div> )}{isGuest && (s || p) && !absence && !isOtherObjectiveShift && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm"/></div>)}{isOtherObjectiveShift && content && (<div className="absolute bottom-0 left-0"><MapPin size={7} className="text-slate-300 drop-shadow-sm"/></div>)}{selectedGrupo && grupoUnifiedMode && content && !isOtherObjectiveShift && activeShift?.objectiveId && selectedGrupo.objectiveIds.includes(activeShift.objectiveId) && (() => {
                                                    const _oi = selectedGrupo.objectiveIds.indexOf(activeShift.objectiveId!);
                                                    const _clr = GRUPO_COLOR_HEX[_oi % GRUPO_COLOR_HEX.length];
                                                    const _nm = (selectedGrupo.objectiveNames[_oi] || '').trim().split(/\s+/).filter((w: string) => w.length > 1).pop()?.slice(0, 6).toUpperCase() || (selectedGrupo.objectiveNames[_oi] || '').slice(0, 5).toUpperCase();
                                                    return (<>
                                                        <div className="absolute top-0 left-0 bottom-0 w-0.5 opacity-80" style={{ backgroundColor: _clr }}/>
                                                        <div className="absolute bottom-0 left-0.5 right-0 text-[5.5px] font-black text-white leading-tight text-center overflow-hidden" style={{ backgroundColor: _clr + 'cc' }}>{_nm}</div>
                                                    </>);
                                                })()}{hasRfzOverlay && (<div className="absolute top-0 right-0 text-[7px] font-black bg-red-600 text-white px-0.5 rounded-bl">RFZ</div>)}{rfzOnCell && !s && !p && !absence && rfzOnCell.draft && (<div className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-400 border border-white" title="Sin publicar"/>)}</div></td>;
                                    })}
                                </tr>
                            )}
                            
                            {/* FILA SNAPSHOT (HISTÓRICA) - Solo se muestra si hay snapshotData y estamos en modo snapshot */}
                            {isSnapshotView && snapshotData && (
                                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                    <td className="sticky left-0 z-20 bg-white dark:bg-slate-800 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                                        <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                    </td>
                                    {daysInMonth.map((day) => {
                                        const key = `${emp.id}_${getDateKey(day)}`;
                                        const snapShift = snapshotData[key];
                                        const isCellWeekend = [0, 6].includes(day.getDay());
                                        let content = null;
                                        let style = '';
                                        if (snapShift) {
                                            if (snapShift.isFrancoTrabajado) { content = 'FT'; style = SHIFT_STYLES['FT']; }
                                            else if (snapShift.isFrancoCompensatorio) { content = 'FF'; style = SHIFT_STYLES['FF']; }
                                            else {
                                                content = snapShift.code;
                                                style = getDefaultStyle(snapShift.code);
                                            }
                                            if (snapShift.isExtended || snapShift.isEarlyStart || snapShift.isRetention) {
                                                style = SHIFT_STYLES['EXTENDED'];
                                            }
                                        }
                                        if (compareChangedKeys?.has(key)) {
                                            style += ' ring-2 ring-amber-600 ring-offset-1 z-20';
                                        }
                                        return (
                                            <td key={`snap_${key}`} className={`border-b border-r p-0.5 text-center ${isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`}>
                                                <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style}`}>{content}</div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
                {/* ── Fila Eventos: TURAs imputadas a extras (prefactura) — no cubre SLA ── */}
                {!isSnapshotView && Object.keys(planningEventosCellsByDay).length > 0 && (
                    <tr className="hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                        <td
                            className="sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 bg-violet-50 border-violet-200 dark:bg-violet-950/30 dark:border-violet-800"
                            style={{ width: nameColWidth, minWidth: nameColWidth }}
                        >
                            <div className="flex flex-col min-w-0">
                                <span className="text-[9px] font-black uppercase tracking-wide leading-tight text-violet-800 dark:text-violet-200">
                                    Eventos
                                </span>
                                <span className="text-[8px] font-bold truncate text-violet-600 dark:text-violet-400" title="TURAs imputadas a Eventos — facturan en prefactura, no suman cobertura SLA">
                                    Extras TURA · prefactura
                                </span>
                            </div>
                        </td>
                        {daysInMonth.map((day) => {
                            const dayStr = getDateKey(day);
                            const cell = planningEventosCellsByDay[dayStr];
                            const isCellWeekend = [0, 6].includes(day.getDay());
                            const tooltip = cell ? formatPlanningEventosTooltip(cell) : '';
                            const hrsLabel = cell
                                ? (Number.isInteger(cell.totalHours) ? String(cell.totalHours) : cell.totalHours.toFixed(1))
                                : '';
                            return (
                                <td
                                    key={`eventos_${dayStr}`}
                                    className={`border-b border-r p-0.5 text-center ${isCellWeekend ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''}`}
                                    onMouseEnter={(e) => {
                                        if (!cell) { setShiftTooltip(null); return; }
                                        setShiftTooltip({
                                            label: tooltip,
                                            pos: 'Eventos',
                                            range: cell.entries.map((en) => `${en.guardName} ${en.range}`).join(' · '),
                                            x: e.clientX,
                                            y: e.clientY,
                                            restHours: null,
                                        });
                                    }}
                                    onMouseLeave={() => setShiftTooltip(null)}
                                >
                                    {cell && (
                                        <div
                                            className="w-full h-6 rounded flex flex-col items-center justify-center text-[8px] font-black border bg-violet-600 text-white border-violet-700 leading-none"
                                            title={tooltip}
                                        >
                                            <span>EVT</span>
                                            <span className="text-[7px] font-bold opacity-90">{hrsLabel}h</span>
                                        </div>
                                    )}
                                </td>
                            );
                        })}
                    </tr>
                )}
                {/* ── Filas de refuerzo RFZ VACANTE — solo sin guardia asignado (asignados van en fila del empleado) ── */}
                {!isSnapshotView && rfzTodos.filter(rfz => {
                    if (rfz.objectiveId !== selectedObjective) return false;
                    if (rfz.employeeId && rfz.employeeId !== 'VACANTE') return false;
                    const mp = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                    return String(rfz.fecha || '').startsWith(mp);
                }).map((rfz) => {
                    const rfzStart = formatTime(rfz.startTime);
                    const rfzEnd   = formatTime(rfz.endTime);
                    const rfzFechaCorta = rfz.fecha ? String(rfz.fecha).split('-').reverse().slice(0, 2).join('/') : '';
                    const asignado = !!rfz.employeeId && rfz.employeeId !== 'VACANTE';
                    const guardiaNombre = asignado
                        ? (rfz.employeeName || employees.find(e => e.id === rfz.employeeId)?.name || 'Guardia')
                        : null;
                    const pendiente = asignado && rfz.draft === true;
                    return (
                        <tr key={`rfz_${rfz.id}`} className={asignado ? 'hover:bg-emerald-50/30' : 'hover:bg-red-50/30'}>
                            <td className={`sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${asignado ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}
                                style={{ width: nameColWidth, minWidth: nameColWidth }}>
                                <div className="flex flex-col min-w-0">
                                    <span className={`text-[9px] font-black uppercase tracking-wide leading-tight ${asignado ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {asignado ? (guardiaNombre as string) : 'VACANTE RFZ'}{rfzFechaCorta ? ` · ${rfzFechaCorta}` : ''}
                                    </span>
                                    <span className={`text-[8px] font-bold truncate ${asignado ? 'text-emerald-600' : 'text-red-500'}`} title={rfz.positionName || ''}>
                                        REFUERZO · {rfz.positionName || 'Sin puesto'} · {rfzStart}–{rfzEnd}{pendiente ? ' · sin publicar' : ''}
                                    </span>
                                </div>
                            </td>
                            {daysInMonth.map((day) => {
                                const dayStr = getDateKey(day);
                                const isRfzDay = rfz.fecha === dayStr;
                                const isCellWeekend = [0, 6].includes(day.getDay());
                                return (
                                    <td key={`rfz_${rfz.id}_${dayStr}`}
                                        onClick={() => {
                                            if (!isRfzDay) return;
                                            activateRfzCorrectionFlow();
                                            setRfzAsignando(rfz);
                                        }}
                                        className={`border-b border-r p-0.5 text-center ${isCellWeekend ? 'bg-rose-50/40' : ''} ${isRfzDay ? 'cursor-pointer' : ''}`}>
                                        {isRfzDay && (
                                            <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black border transition-colors ${asignado
                                                ? (pendiente ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600' : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600')
                                                : 'bg-red-500 text-white border-red-600 hover:bg-red-600'}`}
                                                title={asignado ? `RFZ asignado a ${guardiaNombre}${pendiente ? ' (pendiente de publicar)' : ''}` : 'Vacante RFZ — tocá para asignar'}>
                                                RFZ
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    );
                })}
            </tbody>
            {!gridOpts?.hideFooter && (
            <tfoot className={`sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 ${gridOpts?.highlightCoverageFooter ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-300 ring-inset' : 'bg-slate-50 border-slate-300'}`}>
                <tr>
                    <td className={`sticky left-0 z-20 p-2 border-r border-b font-black text-[10px] uppercase shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${gridOpts?.highlightCoverageFooter ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-500'}`} style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <div className="flex items-center justify-between gap-2 w-full">
                            <button
                                type="button"
                                onClick={() => setHoursMode((m) => (m === 'mes' ? 'cct' : 'mes'))}
                                title={hoursMode === 'mes'
                                    ? 'Mostrando horas del mes calendario. Click para ver horas del ciclo CCT (26→25, tope 200h).'
                                    : 'Mostrando horas del ciclo CCT actual (26→25, tope 200h). Click para volver al mes calendario.'}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide transition-colors ${
                                    hoursMode === 'cct'
                                        ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                }`}
                            >
                                <span>Hs:</span>
                                <span>{hoursMode === 'cct' ? 'CCT' : 'Mes'}</span>
                            </button>
                            <span className={`flex items-center gap-1 ${gridOpts?.highlightCoverageFooter ? 'text-rose-700' : 'text-slate-500'}`}>
                                <ShieldCheck size={12}/> Cobertura:
                            </span>
                        </div>
                    </td>
                    {daysInMonth.map(day => {
                        const dateStr = getDateKey(day);
                        const dayLetter = getDayLetter(dateStr);

                        // Puestos cerrados: 1 pax = esquema SLA completo (M+T+N, D12+N12, M+T, etc.).
                        let requiredPax = 0;
                        let closedPax = 0;
                        const cyclesForCoverage = autoSelectedCyclesRef.current?.length
                            ? autoSelectedCyclesRef.current
                            : autoCycles;
                        if (selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0) {
                            // Vista unificada: misma lógica que cada crono (incluye créditos Ext+Adel).
                            // No reutilizar cycles del objetivo seleccionado: cada SLA del grupo tiene su propia rotación.
                            selectedGrupo.objectiveIds.forEach((objId: string) => {
                                const units = sumGrupoObjectiveCoverageForDay(objId, dateStr, dayLetter, undefined);
                                requiredPax += units.required;
                                closedPax += units.closed;
                            });
                        } else {
                        (positionStructure || []).forEach((pos: any) => {
                            const units = countPositionClosedUnits(
                                dateStr, pos, dayLetter,
                                dotacionBaseEmployees, pendingChanges, shiftsMap,
                                cyclesForCoverage,
                            );
                            requiredPax += units.required;
                            closedPax += units.closed;
                        });
                        }

                        const isCovered = requiredPax > 0 && closedPax >= requiredPax;
                        const cls = requiredPax === 0 ? 'bg-slate-50 text-slate-400' : (isCovered ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600 cursor-pointer');
                        return (
                            <td
                                key={dateStr}
                                className={`text-center border-r border-b text-[10px] font-black ${cls}`}
                                colSpan={1}
                                title={requiredPax > 0
                                    ? `${closedPax} de ${requiredPax} puestos cerrados (1 pax = esquema SLA completo del día)`
                                    : undefined}
                                onClick={(e) => {
                                    if (isCovered || requiredPax === 0) return;
                                    const codeCounts = buildDayCodeCountsByPosition(dateStr);
                                    const dayReport = analyzeDayCoverageGaps(
                                        positionStructure || [],
                                        dateStr,
                                        dayLetter,
                                        codeCounts,
                                        cyclesForCoverage,
                                        isPosActiveOnDay,
                                    );
                                    const gaps = dayReport.positions.length > 0
                                        ? flattenDayGapsForUi(dayReport)
                                        : (autoV2GenStats?.uncoveredSlotsByDay?.[dateStr] || []);
                                    if (gaps.length > 0) setCoverageTooltip(prev => prev?.dateStr === dateStr ? null : { dateStr, gaps, x: e.clientX, y: e.clientY });
                                }}
                            >
                                {requiredPax > 0 ? `${closedPax}/${requiredPax}` : '-'}
                            </td>
                        );
                    })}
                </tr>
            </tfoot>
            )}
        </table>
        );
    };

    const compareDiffKeys = planningCompareDiff?.changedKeys ?? null;
    const compareSnapshotSparse = !!(
        comparingSnapshot?.data
        && isSparsePlanningSnapshot(
            comparingSnapshot.data,
            compareGridEmployees.length || displayedEmployees.length,
            daysInMonth.length,
        )
    );
    const compareGridOpts = { hideFooter: true, minimalHeader: true, compactRows: true } as const;
    const compareSnapshotLabel = comparingSnapshot
        ? new Date(comparingSnapshot.date).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
    const selectedClientLabel = clients.find(c => c.id === selectedClient)?.name || '';
    const selectedObjectiveLabel = selectedClient && selectedObjective
        ? ((clients.find(c => c.id === selectedClient)?.objetivos || []).find((o: any) => (o.id || o.name) === selectedObjective)?.name || selectedObjective)
        : '';

    const coverageTooltipLayout = useMemo(() => {
        if (!coverageTooltip) return null;
        const estH = 56 + coverageTooltip.gaps.length * 92;
        return clampPlanifFloatingPos(coverageTooltip.x, coverageTooltip.y, 320, estH);
    }, [coverageTooltip]);

    const openSlaGapCloseFromPie = useCallback((
        dateStr: string,
        gap: { positionName: string; code: string; gapBand?: string; missing: number; detail?: string },
    ) => {
        const gapBand = inferGapBandForClose(gap);
        if (!gapBand) {
            toast.error('No se pudo determinar la banda SLA a cerrar. Usá Tratamiento o Extender jornada.');
            return;
        }
        setCoverageTooltip(null);
        setSlaGapCloseModal({ dateStr, positionName: gap.positionName, gapBand });
    }, []);

    return (
        <DashboardLayout>
            <Head><title>Planificador</title></Head>
            {planningBusyLabel && (
                <div className="fixed top-4 right-16 z-[9998] flex items-center gap-1.5 bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg pointer-events-none opacity-80">
                    <Loader2 size={12} className="animate-spin"/>
                    {planningBusyLabel}
                </div>
            )}
            <style>{`.pattern-grid { background-image: linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb); background-size: 10px 10px; background-position: 0 0, 5px 5px; } .sla-excluded-day-col { background-image: repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(251, 113, 133, 0.07) 4px, rgba(251, 113, 133, 0.07) 8px); } .planning-grid-table { border-collapse: separate; border-spacing: 0; } .planning-grid-table thead th { box-shadow: 0 1px 0 rgba(148,163,184,0.35); } .planning-grid-table .planning-sticky-corner { position: sticky; left: 0; top: 0; z-index: 50; } @media print { @page { size: A4 landscape; margin: 5mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background-color: white !important; } #printable-section { position: absolute; left: 0; top: 0; width: 100%; min-width: 100%; transform: none; background: white; } .no-print { display: none !important; } .custom-scrollbar { overflow: visible !important; height: auto !important; } }`}</style>
            <div className="no-print px-2 max-w-[1600px] mx-auto">
                <SwapSupervisorQueue empresaId={empresaId} />
            </div>
            {coverageTooltip && coverageTooltipLayout && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed z-[9999]"
                    style={{ left: coverageTooltipLayout.left, top: coverageTooltipLayout.top }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="bg-slate-900 text-white text-[10px] font-black px-3 py-2 rounded-lg shadow-sm flex flex-col gap-1.5 min-w-[240px] max-w-[320px]">
                        <div className="text-rose-300 text-[9px] uppercase tracking-wide mb-0.5">Puestos sin cerrar · {coverageTooltip.dateStr.slice(8)}</div>
                        {coverageTooltip.gaps.map((g, i) => (
                            <div key={i} className="flex flex-col gap-1 border-b border-slate-700/50 pb-1.5 last:border-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-200">{g.positionName}</span>
                                    <span className="text-rose-400 font-black shrink-0">{g.missing} pax</span>
                                </div>
                                {'detail' in g && g.detail && (
                                    <span className="text-[9px] text-slate-400 font-medium leading-snug">{g.detail}</span>
                                )}
                                {(() => {
                                    const closeBand = inferGapBandForClose(g);
                                    return closeBand ? (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openSlaGapCloseFromPie(coverageTooltip.dateStr, g);
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        className="mt-0.5 w-full py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[9px] font-black uppercase tracking-wide pointer-events-auto"
                                    >
                                        Cerrar banda {closeBand}
                                    </button>
                                    ) : null;
                                })()}
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setCoverageTooltip(null)}
                            className="text-slate-500 text-[8px] mt-1 text-left hover:text-slate-300"
                        >
                            Cerrar
                        </button>
                    </div>
                </div>,
                document.body,
            )}
            {shiftExtendModal && planningObjectiveIdForModals && typeof document !== 'undefined' && createPortal(
                <PlanningShiftExtendModal
                    data={shiftExtendModal}
                    objectiveId={planningObjectiveIdForModals}
                    clientId={selectedClient || undefined}
                    employees={displayedEmployees}
                    shiftsMap={shiftsMap}
                    pendingChanges={pendingChanges}
                    positionStructure={effectivePosStructure as import('@/lib/planificacion/vacancySplitBands').VacancyPositionSla[]}
                    onApply={(changes) => {
                        setPendingChanges(changes);
                        setSelectedCell(null);
                        toast.success('Extensión aplicada en borrador — guardá el cronograma.');
                    }}
                    onClose={() => setShiftExtendModal(null)}
                    onRequestSupervisorAuth={(conflicts, onAuthorized) => {
                        requestSupervisorFrancoAuth(conflicts, onAuthorized, 'extensión de jornada');
                    }}
                />,
                document.body,
            )}
            {slaGapCloseModal && planningObjectiveIdForModals && typeof document !== 'undefined' && createPortal(
                <PlanningSlaGapCloseModal
                    data={slaGapCloseModal}
                    objectiveId={planningObjectiveIdForModals}
                    clientId={selectedClient || undefined}
                    employees={displayedEmployees}
                    shiftsMap={shiftsMap}
                    pendingChanges={pendingChanges}
                    positionStructure={effectivePosStructure as import('@/lib/planificacion/vacancySplitBands').VacancyPositionSla[]}
                    onApply={(changes) => {
                        setPendingChanges(changes);
                        toast.success('Hueco SLA cerrado en borrador — guardá el cronograma.');
                    }}
                    onClose={() => setSlaGapCloseModal(null)}
                    onRequestSupervisorAuth={(conflicts, onAuthorized) => {
                        requestSupervisorFrancoAuth(conflicts, onAuthorized, 'cierre hueco SLA');
                    }}
                />,
                document.body,
            )}
            {shiftTooltip && (
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: shiftTooltip.x + 10, top: shiftTooltip.y - 64 }}
                >
                    <div className={`bg-slate-900 text-white text-[10px] font-black px-2.5 py-2 rounded-lg shadow-sm flex flex-col gap-1 max-w-[240px] ${shiftTooltip.label?.includes('\n') ? 'whitespace-pre-line' : 'whitespace-nowrap'}`}>
                        {shiftTooltip.label && (
                            <div className="flex items-start gap-1.5 text-white font-medium">
                                {shiftTooltip.label.startsWith('Tipo:') ? (
                                    <Stethoscope size={9} className="text-rose-300 shrink-0 mt-0.5" />
                                ) : (
                                    <Clock size={9} className="text-indigo-300 shrink-0 mt-0.5" />
                                )}
                                <span>{shiftTooltip.label}</span>
                            </div>
                        )}
                        {shiftTooltip.pos && (
                            <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                                <MapPin size={9} className="text-indigo-300 shrink-0" />
                                {shiftTooltip.pos}
                            </div>
                        )}
                        {shiftTooltip.range && (
                            <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                                <span className="text-indigo-300">⏱</span>
                                {shiftTooltip.range}
                            </div>
                        )}
                        {shiftTooltip.restHours != null && (
                            <div className="flex items-center gap-1.5 text-green-300 font-medium text-[9px]">
                                <span className="text-green-400">⏸</span>
                                Descanso total: <span className="font-black text-green-200">{shiftTooltip.restHours}h</span>
                            </div>
                        )}
                        <div className="text-[8px] text-slate-500 font-medium pt-0.5 border-t border-slate-700">Click para ver detalle / Cambiar</div>
                    </div>
                    <div className="w-2 h-2 bg-slate-900 rotate-45 ml-2 -mt-1" />
                </div>
            )}
            {empPosPicker && typeof document !== 'undefined' && createPortal(
                <>
                <div
                    className="fixed inset-0 z-[9998] bg-black/20"
                    aria-hidden
                    onClick={() => setEmpPosPicker(null)}
                />
                <div
                    className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl overflow-hidden flex flex-col"
                    style={{
                        left: empPosPicker.x,
                        top: empPosPicker.y,
                        width: 260,
                        minWidth: 260,
                        height: empPosPicker.maxHeight,
                        maxHeight: empPosPicker.maxHeight,
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase border-b bg-slate-50 dark:bg-slate-900 tracking-wider shrink-0">
                        Puesto + Turno
                        {empPosPicker.floating && (
                            <span className="ml-1 text-indigo-500 normal-case font-bold">· flotante</span>
                        )}
                        <p className="text-[8px] font-bold normal-case text-slate-400 mt-0.5 tracking-normal">REF/ESC excluyen del auto y dotación · ♂/♀ = puesto con género definido</p>
                    </div>
                    <div className="overflow-y-auto overscroll-contain custom-scrollbar flex-1 min-h-0">
                    {positionStructure.filter((p: any) => {
                        if (!activeSlaPositionAssignments?.length) return true;
                        const _pa = activeSlaPositionAssignments.find((a: any) => a.employeeId === empPosPicker.empId);
                        if (!_pa?.slots?.length) return true;
                        return _pa.slots.some((sl: any) => sl.positionName === p.positionName);
                    }).map(p => {
                        const codes = [...new Set((p.shifts || []).map((s:any) => String(s.code || '').toUpperCase()).filter(Boolean))];
                        const isSelPos = getEmpDefaultPos(empPosPicker.empId) === p.positionName;
                        const selShift = getEmpDefaultShift(empPosPicker.empId);
                        const NORM: Record<string,string> = { D12: 'M', N12: 'N' };
                        const shiftColor: Record<string,string> = {
                            M: 'bg-sky-500 text-white', T: 'bg-amber-500 text-white',
                            N: 'bg-indigo-600 text-white',
                        };
                        const surplusActive = (role: string) => isSelPos && selShift === role;
                        return (
                                <div key={p.positionName} className={`border-b last:border-0 dark:border-slate-700 ${isSelPos ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                                <div className="px-3 pt-2 pb-1 text-[10px] font-black text-slate-600 dark:text-slate-200 flex items-center gap-1.5">
                                    <span>{p.positionName}</span>
                                    {renderPositionGeneroBadge(p.preferenciaGenero)}
                                </div>
                                <div className="flex flex-wrap gap-1 px-3 pb-2">
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, null)}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${isSelPos && !selShift ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}
                                        title="Asignar al puesto sin preferencia de banda"
                                    >
                                        · · ·
                                    </button>
                                    {codes.map((sc:string) => {
                                        const saveCode = NORM[sc] ?? sc;
                                        const displayLabel = NORM[sc] ?? sc;
                                        const is12h = sc === 'D12' || sc === 'N12';
                                        const active = isSelPos && selShift === saveCode;
                                        return (
                                            <button key={sc}
                                                onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, saveCode)}
                                                className={`flex items-center gap-0.5 px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${active ? (shiftColor[saveCode] || 'bg-indigo-600 text-white') : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                                                {displayLabel}
                                                {is12h && <span className={`text-[8px] font-bold ml-0.5 ${active ? 'opacity-80' : 'text-slate-400'}`}>12h</span>}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, 'REF')}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${surplusActive('REF') ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-200'}`}
                                        title="Refuerzo: visible en grilla pero excluido del automatizar y del conteo de dotación"
                                    >
                                        REF
                                    </button>
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, 'ESC')}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${surplusActive('ESC') ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-200'}`}
                                        title="Escuela: visible en grilla pero excluido del automatizar y del conteo de dotación"
                                    >
                                        ESC
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    </div>
                    {getEmpDefaultPos(empPosPicker.empId) && (
                        <button onClick={() => saveEmpPos(empPosPicker.empId, null, null)}
                            className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border-t dark:border-slate-700 transition-colors shrink-0">
                            Quitar prefijo
                        </button>
                    )}
                </div>
                </>,
                document.body,
            )}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out no-print ${selectedClient || comparingSnapshot ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-40 opacity-100'}`}>
                <PageHeader
                    title="Planificador"
                    subtitle="Gestión de turnos y asignaciones"
                    icon={CalendarCheck}
                    className="px-2 pt-2"
                />
            </div>
            <div className={`flex flex-col animate-in fade-in select-none transition-all duration-300 ease-in-out min-h-0 ${cronoFullscreen ? 'fixed inset-0 z-[1100] bg-white dark:bg-slate-900 overflow-hidden p-1 space-y-1' : comparingSnapshot && selectedObjective ? 'h-[calc(100dvh-3.75rem)] overflow-hidden p-0.5 space-y-0.5' : selectedClient ? 'h-[calc(100dvh-5.5rem)] lg:h-[calc(100dvh-6.5rem)] overflow-hidden p-1 space-y-1.5' : 'p-2 space-y-4 h-[calc(100vh-220px)] lg:h-[calc(100vh-160px)]'}`} onMouseUp={handleMouseUp} onClick={() => setEmpPosPicker(null)}>

                <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0 relative z-40 ${comparingSnapshot ? 'py-1 px-2 border-amber-200 bg-amber-50/40' : selectedClient ? 'py-1.5 px-2' : 'p-3'}`}>
                    {comparingSnapshot ? (
                        <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-black text-slate-700 truncate max-w-[220px]" title={`${selectedClientLabel} · ${selectedObjectiveLabel}`}>
                                {selectedClientLabel}<span className="text-slate-400 mx-1">›</span>{selectedObjectiveLabel}
                            </span>
                            <div className="h-4 w-px bg-amber-200 shrink-0"/>
                            <div className="flex items-center bg-white rounded-lg p-0.5 border border-amber-200 shrink-0">
                                <button onClick={() => { if (goToPlanningMonth(currentDate.getFullYear(), currentDate.getMonth()-1)) setAutoGeneratedReady(false); }} aria-label="Mes anterior" className="p-0.5 hover:bg-amber-50 rounded"><ChevronLeft size={14}/></button>
                                <span className="px-2 font-black text-[10px] w-20 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'short', year:'2-digit'})}</span>
                                <button onClick={() => { if (goToPlanningMonth(currentDate.getFullYear(), currentDate.getMonth()+1)) setAutoGeneratedReady(false); }} aria-label="Mes siguiente" className="p-0.5 hover:bg-amber-50 rounded"><ChevronRight size={14}/></button>
                            </div>
                            <div className="h-4 w-px bg-amber-200 shrink-0"/>
                            <Split size={13} className="text-amber-600 shrink-0"/>
                            <span className="text-[10px] font-bold text-amber-900 truncate max-w-[140px]" title={compareSnapshotLabel}>{compareSnapshotLabel}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${planningCompareDiff?.changedCount ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
                                {planningCompareDiff?.changedCount ?? 0} dif.
                            </span>
                            <button
                                type="button"
                                onClick={() => setCompareShowOnlyDiffs((v) => !v)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold border shrink-0 ${compareShowOnlyDiffs ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-200'}`}
                            >
                                Solo cambios
                            </button>
                            <button
                                type="button"
                                onClick={() => setCompareLayout((l) => (l === 'side' ? 'stack' : 'side'))}
                                className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0"
                                title={compareLayout === 'side' ? 'Apilar verticalmente' : 'Ver lado a lado'}
                            >
                                {compareLayout === 'side' ? <PanelLeft size={14}/> : <LayoutList size={14}/>}
                            </button>
                            <button type="button" onClick={() => setShowCompareDiffModal(true)} className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-white text-slate-600 border-slate-200 shrink-0 flex items-center gap-1" title="Listado de celdas distintas">
                                <ArrowLeftRight size={12}/> Detalle
                            </button>
                            <button type="button" onClick={() => setShowCompareSummaryModal(true)} className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0" title="Resumen de horas y dotación"><BarChart3 size={14}/></button>
                            <button type="button" onClick={() => setShowActivityModal(true)} className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0 relative" title="Actividad reciente">
                                <Clock size={14}/>
                                {unifiedLogs.length > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black flex items-center justify-center">{unifiedLogs.length > 9 ? '9+' : unifiedLogs.length}</span>}
                            </button>
                            <button onClick={exitSnapshotMode} className="ml-auto bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-amber-700 shrink-0 flex items-center gap-1"><X size={12}/> Salir</button>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5 no-print">
                                {selectedGrupo ? (
                                    /* MODO GRUPO: etiqueta del grupo + tabs por objetivo */
                                    <>
                                        {/* Botón grupo: activo (violeta sólido) en modo unificado, outline en modo individual */}
                                        <button
                                            onClick={() => { setGrupoUnifiedMode(true); setSelectedObjective(selectedGrupo.objectiveIds[0]); }}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${grupoUnifiedMode ? 'bg-violet-700 text-white' : 'bg-white text-violet-700 border border-violet-400 hover:bg-violet-50'}`}
                                            title="Ver todos los objetivos juntos"
                                        >
                                            <Layers size={11}/>{selectedGrupo.nombre}
                                        </button>
                                        <ChevronRight size={12} className="text-slate-400"/>
                                        {/* Chips por objetivo: clickeables para foco individual */}
                                        {selectedGrupo.objectiveIds.map((objId, i) => (
                                            <button
                                                key={objId}
                                                onClick={() => { setGrupoUnifiedMode(false); setSelectedObjective(objId); }}
                                                className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors ${!grupoUnifiedMode && selectedObjective === objId ? 'bg-indigo-600 text-white' : 'bg-violet-100 text-violet-700 border border-violet-200 hover:bg-indigo-100 hover:text-indigo-700'}`}
                                                title={`Ver solo ${selectedGrupo.objectiveNames[i]}`}
                                            >
                                                {selectedGrupo.objectiveNames[i] || objId}
                                            </button>
                                        ))}
                                        <button onClick={() => handleGrupoChange(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" title="Salir del grupo"><X size={13}/></button>
                                    </>
                                ) : !selectedClient ? (
                                    /* Sin contexto: botón Cliente + botón Grupos */
                                    <>
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setOpenDrop(d => d === 'client' ? null : 'client')}
                                                className="flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide hover:bg-slate-700 transition-colors"
                                            >
                                                Cliente <ChevronDown size={12}/>
                                            </button>
                                            {openDrop === 'client' && (
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[220px] max-h-64 overflow-y-auto">
                                                    {[...clients].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                                                        <button key={c.id} onClick={() => { handleContextChange(c.id, ''); }} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-slate-100 last:border-0">
                                                            {c.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {/* Botón Grupos */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setOpenDrop(d => d === 'grupo' ? null : 'grupo')}
                                                className="flex items-center gap-1.5 bg-violet-700 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide hover:bg-violet-600 transition-colors"
                                                title="Grupos de objetivos"
                                            >
                                                <Layers size={12}/> Grupos <ChevronDown size={12}/>
                                            </button>
                                            {openDrop === 'grupo' && (
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[240px] max-h-72 overflow-y-auto">
                                                    {grupos.length === 0 && (
                                                        <p className="px-4 py-3 text-xs text-slate-400 italic">No hay grupos creados.</p>
                                                    )}
                                                    {grupos.map(g => (
                                                        <div key={g.id} className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 last:border-0 hover:bg-violet-50 group">
                                                            <button
                                                                onClick={() => handleGrupoChange(g)}
                                                                className="flex-1 text-left"
                                                            >
                                                                <p className="text-sm font-semibold text-slate-700 group-hover:text-violet-700">{g.nombre}</p>
                                                                <p className="text-[10px] text-slate-400">{g.clientName} · {g.objectiveIds.length} obj.</p>
                                                            </button>
                                                            <button onClick={() => openGrupoForm('edit', g)} className="p-1 text-slate-300 hover:text-indigo-500" title="Editar"><Edit3 size={11}/></button>
                                                            <button onClick={() => handleDeleteGrupo(g)} className="p-1 text-slate-300 hover:text-rose-500" title="Eliminar"><Trash2 size={11}/></button>
                                                        </div>
                                                    ))}
                                                    <button
                                                        onClick={() => openGrupoForm('new')}
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-violet-700 hover:bg-violet-50 transition-colors rounded-b-xl border-t border-slate-100"
                                                    >
                                                        <Plus size={12}/> Nuevo grupo
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    /* Cliente seleccionado: etiqueta fija + objetivo con dropdown custom + X */
                                    <>
                                        {/* Cliente: fijo, solo se cambia con X */}
                                        <span className="flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide cursor-default select-none">
                                            {clients.find(c => c.id === selectedClient)?.name || 'Cliente'}
                                        </span>
                                        <ChevronRight size={12} className="text-slate-400"/>
                                        {/* Objetivo: dropdown custom al clic */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setOpenDrop(d => d === 'objective' ? null : 'objective')}
                                                className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide hover:bg-indigo-500 transition-colors"
                                            >
                                                {(clients.find(c => c.id === selectedClient)?.objetivos || []).find((o: any) => (o.id || o.name) === selectedObjective)?.name || 'Objetivo'}
                                                <ChevronDown size={12}/>
                                            </button>
                                            {openDrop === 'objective' && (
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[220px] max-h-64 overflow-y-auto">
                                                    {/* Objetivos del cliente */}
                                                    {[...(clients.find(c => c.id === selectedClient)?.objetivos||[])].sort((a:any,b:any) => a.name.localeCompare(b.name)).map((o:any) => (
                                                        <button key={o.id||o.name} onClick={() => { handleContextChange(selectedClient, o.id||o.name); }} className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors first:rounded-t-xl border-b border-slate-100 last:border-0 ${(o.id||o.name) === selectedObjective ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'}`}>
                                                            {o.name}
                                                        </button>
                                                    ))}
                                                    {/* Grupos de este cliente */}
                                                    {grupos.filter(g => g.clientId === selectedClient).length > 0 && (
                                                        <>
                                                            <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 border-t border-slate-100">Grupos</div>
                                                            {grupos.filter(g => g.clientId === selectedClient).map(g => (
                                                                <button key={g.id} onClick={() => handleGrupoChange(g)} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 transition-colors border-b border-slate-100 last:border-0 flex items-center gap-2">
                                                                    <Layers size={11} className="shrink-0"/>{g.nombre}
                                                                    <span className="text-[10px] text-slate-400 ml-auto">{g.objectiveIds.length} obj.</span>
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {/* Advertencia: objetivo sin coordenadas */}
                                        {selectedObjective && selectedObjectiveData && !Number(selectedObjectiveData?.lat ?? 0) && (
                                            <a href="/admin/crm" title="El objetivo no tiene coordenadas. Las distancias no se pueden calcular. Ir a CRM → Objetivo → Geolocalizar." className="flex items-center gap-1 px-2 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-amber-700 text-xs font-bold hover:bg-amber-100 transition-colors">
                                                <MapPin size={11} className="text-amber-500 shrink-0"/>
                                                Sin coords
                                            </a>
                                        )}
                                        {/* X: limpia cliente y objetivo */}
                                        <button onClick={() => handleContextChange('', '')} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" title="Limpiar selección"><X size={13}/></button>
                                    </>
                                )}
                            </div>
                            
                            {/* CRONO: ALERTAS DE ESTADO DEL SERVICIO (V8.20) */}
                            {isServiceLocked && (
                                <div className={`flex-1 bg-rose-50 border-rose-200 border px-4 py-2 rounded-xl flex items-center gap-3 animate-in slide-in-from-top shadow-md`}>
                                    <div className="p-2 bg-rose-100 rounded-lg text-rose-600 animate-pulse"><PowerOff size={20}/></div>
                                    <div>
                                        <p className="text-xs font-black text-rose-700 uppercase">{activeServiceStatus.msg}</p>
                                        <p className="text-[10px] text-rose-600 font-medium">La planificación está bloqueada. No se pueden realizar cambios.</p>
                                    </div>
                                </div>
                            )}



                            {!isServiceLocked && (Object.keys(pendingChanges).length > 0 || backgroundSaveCount > 0) && (
                                <div className="flex items-center gap-2 animate-in slide-in-from-top-2 flex-wrap no-print">
                                    {backgroundSaveCount > 0 && (
                                        <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-200 shadow-sm">
                                            <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0"/>
                                            <span className="text-[10px] font-black text-indigo-700 uppercase tracking-wide">
                                                Guardando en segundo plano{backgroundSaveCount > 1 ? ` (${backgroundSaveCount})` : ''}…
                                            </span>
                                        </div>
                                    )}
                                    {Object.keys(pendingChanges).length > 0 && (
                                        <div className="flex items-center gap-2 bg-amber-50 p-1.5 rounded-xl border border-amber-200 shadow-lg">
                                            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest hidden md:inline">Planificando como: {activeActorName}</span>
                                            <div className="h-4 w-px bg-amber-200 mx-1 hidden md:block"></div>
                                            <span className="text-xs font-black text-amber-700 px-1">{Object.values(pendingChanges).filter((v: any) => !v?._isAutoRotation && !v?._isAutoCondition).length || Object.keys(pendingChanges).length} cambios</span>
                                            <button type="button" onClick={undoLastPending} title="Deshacer último cambio (Ctrl+Z)" className="p-1.5 hover:bg-amber-100 rounded-lg text-amber-600"><Undo size={16}/></button>
                                            <button type="button" onClick={() => { if (confirm('¿Descartar todos los cambios pendientes?')) { setPendingChanges({}); clearUndoStack(); } }} title="Descartar todos los cambios" className="p-1.5 hover:bg-rose-100 rounded-lg text-rose-500"><X size={16}/></button>
                                            <button onClick={handleSaveAll} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 shadow">
                                                <Save size={14}/> GUARDAR
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            </div>

                            <div className="flex-shrink-0 flex items-center gap-2 no-print">
                                {/* CRONOGRAMAS — solo expandido */}
                                {!toolbarCollapsed && (
                                    <button
                                        type="button"
                                        onClick={() => setShowCronogramasOverview(true)}
                                        title="Ver estado de cronogramas de todos los objetivos"
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors border bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 shadow-sm"
                                    >
                                        <Database size={12}/>
                                        CRONOGRAMAS
                                    </button>
                                )}

                                {/* REFERENCIAS — solo expandido */}
                                {!toolbarCollapsed && (
                                    <button
                                        onClick={() => setShowLegend(!showLegend)}
                                        className={`p-2 rounded-xl transition-colors border ${showLegend ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-transparent hover:bg-white text-slate-500'}`}
                                        title="Ver Referencias de Colores"
                                    >
                                        <Info size={18}/>
                                    </button>
                                )}
                                {showLegend && renderLegend()}

                                {/* BELL — solo expandido */}
                                {!toolbarCollapsed && (
                                    <div className="relative">
                                        <button
                                            ref={notifBtnRef}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (showNotifications) {
                                                    setShowNotifications(false);
                                                } else {
                                                    repositionNotifPanel();
                                                    setShowNotifications(true);
                                                    setHasUnread(false);
                                                }
                                            }}
                                            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl relative"
                                        >
                                            <Bell size={18}/>{(hasUnread || bellNotifications.length > 0) && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white animate-pulse"></span>}
                                        </button>
                                    </div>
                                )}
                                {showNotifications && typeof document !== 'undefined' && createPortal(
                                    <>
                                        <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowNotifications(false)} />
                                        <div
                                            className="fixed z-[9999] w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border overflow-hidden animate-in zoom-in-95"
                                            style={{ top: notifPanelTop, right: 16 }}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            <div className="p-3 bg-slate-50 border-b flex justify-between items-center">
                                                <h3 className="font-black text-xs uppercase text-slate-500">Alertas</h3>
                                                <div className="flex items-center gap-2">
                                                    {notifications.length > 0 && (
                                                        <div className="flex items-center gap-1">
                                                            <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded">
                                                                <Check size={12}/> Leído
                                                            </button>
                                                            <button onClick={handleDeleteAllNotifications} className="text-[10px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 bg-rose-50 px-2 py-1 rounded">
                                                                <Trash2 size={12}/> Borrar
                                                            </button>
                                                        </div>
                                                    )}
                                                    <button onClick={() => setShowNotifications(false)}><X size={14}/></button>
                                                </div>
                                            </div>
                                            <div className="max-h-80 overflow-y-auto custom-scrollbar">
                                                {bellNotifications.length > 0 ? bellNotifications.map((notif, i) => (
                                                    <div key={i} className="p-3 border-b last:border-0 hover:bg-slate-50 flex gap-3 items-start cursor-pointer group" onClick={() => handleNotificationClick(notif)}>
                                                        <div className={`p-2 rounded-full ${notif.title?.includes('⚠️') ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                            {notif.source === 'NOVEDAD' ? <AlertTriangle size={16}/> : <CalendarX size={16}/>}
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-xs font-bold text-slate-800">{notif.title}</p>
                                                            <p className="text-[10px] text-slate-500">{notif.msg}</p>
                                                            <div className="flex justify-between mt-1">
                                                                <p className="text-[9px] font-mono text-slate-400">{notif.createdAt?.seconds ? new Date(notif.createdAt.seconds * 1000).toLocaleDateString('es-AR') : (notif.date || '--')}</p>
                                                                <span className="text-[9px] font-bold text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">Ir a detalle →</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )) : <div className="p-6 text-center text-slate-400 text-xs">Sin novedades recientes.</div>}
                                            </div>
                                        </div>
                                    </>,
                                    document.body,
                                )}

                                {/* DIAGNÓSTICO ESTRUCTURA — compacto, en toolbar derecho */}
                                {selectedObjective && !isServiceLocked && (
                                    <div className="relative hidden md:block">
                                        <button
                                            ref={diagnosticBtnRef}
                                            onClick={() => {
                                                if (showDiagnostic) {
                                                    setShowDiagnostic(false);
                                                } else {
                                                    repositionDiagnosticPanel();
                                                    setShowDiagnostic(true);
                                                }
                                            }}
                                            className="flex px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl items-center gap-1.5 animate-in fade-in shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500 transition-colors"
                                        >
                                            <Activity size={12} className="text-emerald-500 animate-pulse shrink-0"/>
                                            <div className="flex flex-col leading-none">
                                                <span className="text-[8px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">Estructura</span>
                                                <span className="text-[9px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                                    {(selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0)
                                                        ? Object.values(grupoSlaMap).reduce((s, st) => s + st.length, 0)
                                                        : positionStructure.length}P
                                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                                    <span className="text-emerald-600 font-black">{(selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0)
                                                        ? Object.values(grupoSlaMap).reduce((s, st) => s + st.reduce((a: number, p: any) => a + (Number(p.qty) || 1), 0), 0)
                                                        : positionStructure.reduce((acc, curr) => acc + (curr.qty || 1), 0)}Pax</span>
                                                    {genderRestrictedPositionsCount > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span className="text-pink-600 font-black">{genderRestrictedPositionsCount}G</span></>}
                                                    {((selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0) ? grupoTotalVendidas : slaVendidas) > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span className="text-teal-600 font-black">{(selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0) ? grupoTotalVendidas : slaVendidas}h</span></>}
                                                </span>
                                            </div>
                                            <ChevronDown size={10} className={`text-slate-400 transition-transform shrink-0 ${showDiagnostic ? 'rotate-180' : ''}`}/>
                                        </button>
                                    </div>
                                )}

                                {/* DIAGNÓSTICO COBERTURA — compacto, en toolbar derecho */}
                                {selectedObjective && !isServiceLocked && (selectedGrupo && grupoUnifiedMode ? grupoGapReport : objectiveCoverageGapReport) && (() => {
                                    const _rpt = (selectedGrupo && grupoUnifiedMode ? grupoGapReport : objectiveCoverageGapReport)!;
                                    const _ok = _rpt.worstDays.length === 0;
                                    return (
                                        <div className="relative hidden md:block">
                                            <button
                                                ref={coverageDiagnosticBtnRef}
                                                onClick={() => {
                                                    if (showCoverageDiagnostic) {
                                                        setShowCoverageDiagnostic(false);
                                                    } else {
                                                        repositionCoveragePanel();
                                                        setShowCoverageDiagnostic(true);
                                                    }
                                                }}
                                                className={`flex px-2.5 py-1.5 border rounded-xl items-center gap-1.5 animate-in fade-in shadow-sm transition-colors ${
                                                    _ok ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300' : 'bg-rose-50 border-rose-200 hover:border-rose-300'
                                                }`}
                                            >
                                                <ShieldCheck size={12} className={_ok ? 'text-emerald-500 shrink-0' : 'text-rose-500 shrink-0'}/>
                                                <div className="flex flex-col leading-none">
                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Cobertura</span>
                                                    <span className="text-[9px] font-bold text-slate-700 flex items-center gap-1">
                                                        <span className="text-emerald-600 font-black">{_rpt.daysFull}OK</span>
                                                        {(_rpt.daysPartial + _rpt.daysEmpty) > 0 && <><span className="text-slate-300">|</span><span className="text-rose-600 font-black">{_rpt.daysPartial + _rpt.daysEmpty}✗</span></>}
                                                    </span>
                                                </div>
                                                <ChevronDown size={10} className={`text-slate-400 transition-transform shrink-0 ${showCoverageDiagnostic ? 'rotate-180' : ''}`}/>
                                            </button>
                                        </div>
                                    );
                                })()}

                                {/* ACCIONES PUBLICACIÓN — compactas, entre selector y mes */}
                                {selectedObjective && (() => {
                                    const publishLookupKey = planificacionPublishLookupKey(
                                        selectedObjective,
                                        currentDate.getFullYear(),
                                        currentDate.getMonth() + 1,
                                    );
                                    const published = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
                                    const needsRepublish = !!needsRepublishMap[publishLookupKey];
                                    return (
                                        <div className="flex items-center gap-1 no-print">
                                            <button
                                                type="button"
                                                onClick={() => void refreshCronogramaView()}
                                                disabled={isRefreshingCrono}
                                                title="Actualizar turnos y puestos"
                                                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                                            >
                                                <RefreshCw size={12} className={isRefreshingCrono ? 'animate-spin' : ''}/>
                                            </button>
                                            {published ? (
                                                <span className="flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                                                    <CheckCircle size={10}/> PUB
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-[9px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                                                    <Ghost size={10}/> BOR
                                                </span>
                                            )}
                                            {canPublishPlanning && (!published || needsRepublish) && (
                                                <button
                                                    onClick={openPublishConfirm}
                                                    disabled={isPublishing}
                                                    title={isSuperAdmin && (slaVendidas > 0 && Math.round(objectiveMonthSlaBaseHours) !== Math.round(slaVendidas) || (objectiveCoverageGapReport && objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty > 0))
                                                        ? 'Super Admin: podés publicar aunque SLA o cobertura no coincidan'
                                                        : published ? 'Re-publicar cronograma' : 'Publicar cronograma'}
                                                    className={`flex items-center gap-1 disabled:opacity-60 text-white px-2 py-1 rounded-lg text-[9px] font-black transition-colors shadow ${needsRepublish ? 'bg-amber-500 hover:bg-amber-600 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                                >
                                                    {isPublishing ? <Loader2 size={10} className="animate-spin"/> : <CalendarCheck size={10}/>}
                                                    {published ? 'RE-PUB' : 'PUBLICAR'}
                                                </button>
                                            )}
                                            {published && canCorrectPlanning && (
                                                <button
                                                    onClick={() => setCorrectionMode(v => !v)}
                                                    title="Modo Corrección: permite editar cronograma publicado sin FT/FF"
                                                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black transition-colors border ${correctionMode ? 'bg-rose-600 text-white border-rose-700 shadow-lg' : 'bg-white text-rose-600 border-rose-300 hover:bg-rose-50'}`}
                                                >
                                                    <ShieldAlert size={10}/>
                                                    {correctionMode ? 'CORR ●' : 'CORR'}
                                                </button>
                                            )}
                                            {published && isSuperAdmin && (
                                                <button
                                                    onClick={handleUnpublish}
                                                    disabled={isUnpublishing}
                                                    title="SuperAdmin: despublica solo este objetivo y mes. No borra turnos."
                                                    className="p-1.5 rounded-lg border bg-white text-slate-500 border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                                                >
                                                    {isUnpublishing ? <Loader2 size={10} className="animate-spin"/> : <CalendarX size={10}/>}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })()}
                                <div className="w-px h-5 bg-slate-200 shrink-0"/>

                                {/* < MES > — siempre visible */}
                                <div className="flex items-center bg-slate-100 rounded-xl p-1"><button onClick={() => { if (goToPlanningMonth(currentDate.getFullYear(), currentDate.getMonth()-1)) setAutoGeneratedReady(false); }} aria-label="Mes anterior" className="p-1 hover:bg-white rounded-lg"><ChevronLeft size={16} aria-hidden="true"/></button><span className={`px-3 font-black text-xs w-24 text-center capitalize ${planningMonthTier === 'warm' ? 'text-amber-700' : ''}`}>{currentDate.toLocaleDateString('es-AR', {month:'long'})}</span><button onClick={() => { if (goToPlanningMonth(currentDate.getFullYear(), currentDate.getMonth()+1)) setAutoGeneratedReady(false); }} aria-label="Mes siguiente" className="p-1 hover:bg-white rounded-lg"><ChevronRight size={16} aria-hidden="true"/></button></div>

                                <button
                                    onClick={applyPrevMonthTemplate}
                                    disabled={!selectedObjective || prevMonthLoading}
                                    title="Copiar planificación del mes anterior como plantilla"
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-teal-50 hover:text-teal-600 transition-colors disabled:opacity-40"
                                >
                                    {prevMonthLoading ? <Loader2 size={18} className="animate-spin text-teal-600"/> : <CalendarSearch size={18}/>}
                                </button>

                                {/* === ACCIONES SECUNDARIAS — se ocultan al colapsar === */}
                                {!toolbarCollapsed && (
                                    <>
                                        <button onClick={loadHistory} className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver Historial" disabled={!selectedObjective}><History size={18}/></button>

                                        {/* ⋯ MENÚ: Ventana externa + Ajustar + Equilibrar + Puestos */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setToolbarMoreOpen(v => !v)}
                                                className={`p-2 rounded-xl transition-colors border ${toolbarMoreOpen ? 'bg-slate-200 border-slate-300 text-slate-700' : 'bg-slate-100 border-transparent hover:bg-slate-200 text-slate-500'}`}
                                                title="Más acciones"
                                            >
                                                <MoreHorizontal size={18}/>
                                            </button>
                                            {toolbarMoreOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-40" onClick={() => setToolbarMoreOpen(false)}/>
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 min-w-[210px]">
                                                        {canAutoLab && (
                                                            <a
                                                                href="/admin/planificacion/auto-lab"
                                                                onClick={() => setToolbarMoreOpen(false)}
                                                                className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2.5"
                                                                title="Laboratorio de casos sintéticos para auto-planificación"
                                                            >
                                                                <FlaskConical size={14} className="text-indigo-500"/> Lab de casos
                                                            </a>
                                                        )}
                                                        {canAutoLab && <div className="h-px bg-slate-100 mx-2 my-1"/>}
                                                        <button
                                                            onClick={() => {
                                                                if (selectedClient) openCronoPopout({ clientId: selectedClient, objectiveId: floatingInitialObjective, month: currentDate, mainObjectiveId: selectedObjective });
                                                                setToolbarMoreOpen(false);
                                                            }}
                                                            disabled={!selectedClient}
                                                            className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                        >
                                                            <Maximize2 size={14} className="text-indigo-500"/> Ventana externa
                                                        </button>
                                                        <div className="h-px bg-slate-100 mx-2 my-1"/>
                                                        {(() => {
                                                            const _pubKey2 = selectedObjective ? planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1) : '';
                                                            const _blocked2 = !!(_pubKey2 && isPlanificacionPublished(publishStatusMap[_pubKey2])) && !correctionMode;
                                                            return (
                                                                <>
                                                                    <button
                                                                        onClick={() => { setShowAjustarCronoModal(true); setToolbarMoreOpen(false); }}
                                                                        disabled={!selectedObjective || _blocked2}
                                                                        title={_blocked2 ? 'Crono publicado — entrá en CORREGIR para usar Ajustar' : 'Ajustar Crono: comprimir a 12h o liberar retenes para un rango de días'}
                                                                        className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                                    >
                                                                        <ArrowLeftRight size={14} className="text-rose-500"/> Ajustar crono
                                                                    </button>
                                                                    <button
                                                                        onClick={() => { setShowEquilibrarModal(true); setToolbarMoreOpen(false); }}
                                                                        disabled={!selectedObjective || _blocked2}
                                                                        title={_blocked2 ? 'Crono publicado — entrá en CORREGIR para equilibrar' : 'Equilibrar horas: rotar posiciones por bloque para igualar horas entre todos los empleados'}
                                                                        className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                                    >
                                                                        <BarChart2 size={14} className="text-emerald-500"/> Equilibrar horas
                                                                    </button>
                                                                </>
                                                            );
                                                        })()}
                                                        {selectedObjective && Object.keys(empDefaultPos).some(k => k.endsWith(`___${selectedObjective}`)) && (
                                                            <>
                                                                <div className="h-px bg-slate-100 mx-2 my-1"/>
                                                                <button
                                                                    onClick={() => { clearAllPositions(); setToolbarMoreOpen(false); }}
                                                                    className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2.5"
                                                                    title="Quitar todos los puestos asignados en este mes"
                                                                >
                                                                    <X size={14} className="text-orange-500"/> Quitar puestos
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* SORT */}
                                        <div className="flex items-center gap-0.5">
                                            <div className="relative">
                                                {(() => {
                                                    const SORT_OPTIONS: { key: typeof sortBy; label: string; Icon: typeof ArrowDownWideNarrow }[] = [
                                                        { key: 'activity', label: 'Actividad', Icon: ArrowDownWideNarrow },
                                                        { key: 'name', label: 'Nombre', Icon: ArrowDownAZ },
                                                        { key: 'client', label: 'Cliente', Icon: Briefcase },
                                                        { key: 'band', label: 'Banda', Icon: Clock },
                                                        { key: 'position', label: 'Puesto', Icon: LayoutGrid },
                                                    ];
                                                    const activeSort = SORT_OPTIONS.find(o => o.key === sortBy) || SORT_OPTIONS[0];
                                                    const ActiveIcon = activeSort.Icon;
                                                    return (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setBandDropOpen(false);
                                                                    setSortDropOpen(p => !p);
                                                                }}
                                                                className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-l-xl transition-colors border border-transparent hover:border-indigo-200 flex items-center gap-1"
                                                                title={`Orden: ${activeSort.label}`}
                                                            >
                                                                <ActiveIcon size={18}/>
                                                                <ChevronDown size={12} className={sortDropOpen ? 'rotate-180 transition-transform' : 'transition-transform'}/>
                                                            </button>
                                                            {sortDropOpen && (
                                                                <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 min-w-[168px]">
                                                                    <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-700 mb-1">
                                                                        Ordenar por
                                                                    </p>
                                                                    {SORT_OPTIONS.map(({ key, label, Icon }) => {
                                                                        const active = sortBy === key;
                                                                        return (
                                                                            <button
                                                                                key={key}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    startFilterTransition(() => setSortBy(key));
                                                                                    setSortDropOpen(false);
                                                                                }}
                                                                                className={`w-full px-3 py-2 text-left text-[11px] font-bold flex items-center gap-2 transition-colors ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                                                                            >
                                                                                <Icon size={14} className="shrink-0"/>
                                                                                {label}
                                                                                {active && <Check size={12} className="ml-auto text-indigo-600"/>}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                            <button onClick={() => startFilterTransition(() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'))} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-r-xl transition-colors border border-transparent hover:border-indigo-200" title={sortDir === 'asc' ? "Ascendente" : "Descendente"}>{sortDir === 'asc' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
                                        </div>

                                        {/* BAND FILTER */}
                                        <div className="relative" title="Ver el cronograma por banda">
                                            {(() => {
                                                const BAND_COLORS: Record<string, string> = {
                                                    M: 'text-blue-700 border-blue-400 bg-blue-50',
                                                    T: 'text-orange-600 border-orange-400 bg-orange-50',
                                                    N: 'text-indigo-700 border-indigo-500 bg-indigo-50',
                                                    D12: 'text-cyan-700 border-cyan-400 bg-cyan-50',
                                                    N12: 'text-purple-700 border-purple-500 bg-purple-50',
                                                    RET: 'text-amber-700 border-amber-500 bg-amber-50',
                                                };
                                                const activeCls = bandFilter ? BAND_COLORS[bandFilter] : 'text-slate-600 border-slate-300 bg-slate-100';
                                                return (<>
                                                    <button
                                                        onClick={() => { setSortDropOpen(false); setBandDropOpen(p => !p); }}
                                                        className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border transition-colors flex items-center gap-1 ${activeCls}`}
                                                    >
                                                        {bandFilter ?? 'ALL'}
                                                        <ChevronDown size={10}/>
                                                    </button>
                                                    {bandDropOpen && (
                                                        <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[72px]">
                                                            {[null,'M','T','N','D12','N12','RET'].map(b => {
                                                                const label = b ?? 'ALL';
                                                                const active = bandFilter === b;
                                                                const textCls = b ? BAND_COLORS[b].split(' ')[0] : 'text-slate-600';
                                                                return (
                                                                    <button key={label}
                                                                        onClick={() => { startFilterTransition(() => setBandFilter(b)); setBandDropOpen(false); }}
                                                                        className={`w-full px-3 py-1.5 text-left text-[10px] font-black uppercase hover:bg-slate-50 transition-colors ${active ? textCls : 'text-slate-400'}`}
                                                                    >{label}</button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </>);
                                            })()}
                                        </div>

                                        {customOrderMap[selectedObjective || '__all__'] && (
                                            <button onClick={clearCustomOrder} className="p-2 bg-indigo-100 text-indigo-600 hover:bg-rose-100 hover:text-rose-600 rounded-xl transition-colors text-[9px] font-black uppercase flex items-center gap-1" title="Hay orden personalizado — click para restablecer orden automático"><Grip size={12}/><X size={10}/></button>
                                        )}
                                    </>
                                )}

                                {/* DOTACIÓN — filtros arriba, candidatos en la grilla */}
                                <button
                                    type="button"
                                    onClick={() => setForceShowAll(v => !v)}
                                    title={forceShowAll ? 'Cerrar buscador de dotación' : `Buscar RET / franco / sin turno a ≤${nearbyKmRadius} km en el cronograma`}
                                    className={`px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border transition-colors ${forceShowAll ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700'}`}
                                >
                                    {forceShowAll ? <Eye size={14}/> : <EyeOff size={14}/>} Dotación
                                </button>


                                {/* VOLANTE — mostrar/ocultar guardias volante sin turno */}
                                {selectedObjective && (
                                    <button
                                        onClick={() => setShowVolantes(p => !p)}
                                        title={showVolantes ? 'Ocultar volantes sin turno' : 'Mostrar volantes disponibles para este objetivo'}
                                        className={`px-2.5 py-2 rounded-xl border text-xs font-black uppercase flex items-center gap-1.5 transition-colors ${showVolantes ? 'bg-violet-100 border-violet-300 text-violet-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-600'}`}
                                    >
                                        <Shuffle size={13}/> VOL
                                    </button>
                                )}

                                {/* BUSCAR EXTERNO — activa la barra de búsqueda encima del grid */}
                                {selectedObjective && (
                                    <button
                                        onClick={() => {
                                            if (showGuardiaSearch) {
                                                setShowGuardiaSearch(false);
                                                setSearchTerm('');
                                            } else {
                                                setShowGuardiaSearch(true);
                                            }
                                        }}
                                        title="Buscar guardia en el cronograma o en toda la plantilla"
                                        className={`p-2 rounded-xl border text-xs transition-colors ${showGuardiaSearch || pinnedExternalEmpIds.size > 0 ? 'bg-indigo-100 border-indigo-300 text-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600'}`}
                                    >
                                        <Search size={14}/>
                                    </button>
                                )}

                                {/* ASIGNAR — siempre visible */}
                                <button onClick={() => { setAddSearchTerm(''); setShowAddModal(true); }} disabled={!selectedObjective || isServiceLocked} className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"><UserPlus size={14}/> Asignar</button>

                                {/* PANTALLA COMPLETA — siempre visible */}
                                <button
                                    onClick={() => setCronoFullscreen(v => !v)}
                                    title={cronoFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                >
                                    {cronoFullscreen ? <Minimize2 size={18}/> : <Maximize size={18}/>}
                                </button>

                                {/* COLAPSAR BARRA — siempre visible */}
                                <button
                                    onClick={() => setToolbarCollapsed(v => {
                                        const next = !v;
                                        if (typeof window !== 'undefined') localStorage.setItem('planif_toolbar_collapsed', next ? '1' : '0');
                                        return next;
                                    })}
                                    title={toolbarCollapsed ? 'Expandir barra de herramientas' : 'Colapsar barra de herramientas'}
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {toolbarCollapsed ? <ChevronsDown size={14}/> : <ChevronsUp size={14}/>}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* --- ÁREA PRINCIPAL DE LA GRILLA (PLANIFICACIÓN + COMPARACIÓN SPLIT VIEW) --- */}
                <div className={`flex-1 min-h-0 overflow-hidden relative z-0 flex flex-col ${isServiceLocked ? 'opacity-75 grayscale-[0.5] pointer-events-none' : ''}`}>
                    
                    {!selectedObjective ? (
                        <div className="flex flex-col items-center justify-center flex-1 gap-3 select-none">
                            <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center">
                                <Calendar size={32} className="text-slate-300" aria-hidden="true"/>
                            </div>
                            <p className="font-bold text-base text-slate-400">Seleccioná un cliente y objetivo</p>
                            <p className="text-sm text-slate-300">La grilla de planificación aparecerá aquí</p>
                        </div>
                    ) : (
                        <>
                        {(() => {
                            const publishLookupKey = planificacionPublishLookupKey(
                                selectedObjective,
                                currentDate.getFullYear(),
                                currentDate.getMonth() + 1,
                            );
                            const cronogramaPublicado = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
                            if (!cronogramaPublicado || rfzDraftPendientesMes.length === 0) return null;
                            const asignados = rfzDraftPendientesMes.filter(rfz => rfz.employeeId && rfz.employeeId !== 'VACANTE');
                            return (
                                <div className="mx-2 mb-1 flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-black no-print">
                                    <AlertTriangle size={14}/>
                                    {asignados.length > 0
                                        ? `${asignados.length} refuerzo(s) RFZ asignado(s) sin publicar — usá RE-PUBLICAR para notificar a los guardias.`
                                        : `${rfzDraftPendientesMes.length} refuerzo(s) RFZ pendiente(s) — asigná guardia y re-publicá el cronograma.`}
                                </div>
                            );
                        })()}
                        {correctionMode && (
                            <>
                            <div className="mx-2 mb-1 flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-black no-print">
                                <ShieldAlert size={14}/>
                                MODO CORRECCIÓN ACTIVO — Los cambios se guardan directamente sin FT/FF y quedan registrados como corrección de superadmin.
                                <button onClick={() => setCorrectionMode(false)} className="ml-auto underline text-rose-100 hover:text-white">Desactivar</button>
                            </div>
                            {objectiveCoverageGapReport && (
                                <div className="mx-2 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black no-print">
                                    <span className="flex items-center gap-1.5 text-emerald-300">
                                        <ShieldCheck size={12}/> Cierres: {objectiveCoverageGapReport.daysFull} días OK
                                    </span>
                                    {(objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty) > 0 && (
                                        <span className="text-rose-300">
                                            · {objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty} con huecos
                                        </span>
                                    )}
                                    {objectiveCoverageGapReport.worstDays.slice(0, 4).map(wd => (
                                        <span key={wd.dateStr} className="text-rose-200 font-bold">
                                            {wd.dateStr.slice(8, 10)}: {wd.closed}/{wd.required}
                                        </span>
                                    ))}
                                    <span className="text-slate-400 font-bold ml-auto hidden sm:inline">Fila «Cobertura» abajo · click celda roja = detalle</span>
                                </div>
                            )}
                            </>
                        )}
                        {forceShowAll && selectedObjective && !comparingSnapshot && (
                            <div className="mx-2 mb-1 shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 shadow-sm no-print">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1.5">
                                        <Users size={12}/> Dotación
                                    </span>
                                    {([
                                        { id: 'RET' as const, label: 'RET' },
                                        { id: 'LIBRE' as const, label: 'Sin turno' },
                                        { id: 'F' as const, label: 'F' },
                                        { id: null, label: 'Todos' },
                                    ]).map((opt) => {
                                        const active = dotacionPoolType === opt.id;
                                        return (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                onClick={() => setDotacionPoolType(opt.id)}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${active ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-100'}`}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                    <span className="text-[10px] font-black uppercase text-amber-700 ml-1">≤</span>
                                    <input
                                        type="number"
                                        min={DOTACION_NEARBY_KM_MIN}
                                        max={DOTACION_NEARBY_KM_MAX}
                                        value={nearbyKmDraft}
                                        onChange={e => setNearbyKmDraft(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') persistNearbyKm(parseInt(nearbyKmDraft, 10));
                                        }}
                                        className="w-12 text-center text-xs font-black bg-white border border-amber-300 rounded-lg px-1 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <span className="text-[10px] font-black uppercase text-amber-700">km</span>
                                    {ROSTER_KM_PRESETS.map((km) => (
                                        <button
                                            key={km}
                                            type="button"
                                            onClick={() => persistNearbyKm(km)}
                                            className={`px-1.5 py-1 rounded-lg text-[9px] font-black ${nearbyKmRadius === km ? 'bg-amber-600 text-white' : 'bg-white text-amber-800 border border-amber-200'}`}
                                        >{km}</button>
                                    ))}
                                    <input
                                        type="text"
                                        value={dotacionPoolSearch}
                                        onChange={e => setDotacionPoolSearch(e.target.value)}
                                        placeholder="Nombre o legajo…"
                                        className="ml-auto min-w-[140px] flex-1 max-w-[220px] bg-white border border-amber-200 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700"
                                    />
                                    <span className="text-[10px] font-black text-amber-800/80">
                                        {dotacionPoolReady ? `${dotacionPoolCandidates.length} en grilla` : 'Buscando…'}
                                    </span>
                                    <button type="button" onClick={() => setForceShowAll(false)} className="p-1 text-amber-700 hover:text-amber-900" title="Cerrar">
                                        <X size={14}/>
                                    </button>
                                </div>
                                {dotacionPoolReady && dotacionPoolCandidates.length === 0 && (
                                    <p className="text-[11px] font-bold text-amber-800/70 px-1 pt-1.5">
                                        No hay candidatos con ese filtro a ≤{nearbyKmRadius} km. Ampliá el radio o cambiá el tipo.
                                    </p>
                                )}
                            </div>
                        )}
                        {selectedObjective && !comparingSnapshot && (() => {
                            const q = searchTerm.trim();
                            const { inGrid, external } = guardiaSearchMatches;
                            const hasPinned = pinnedExternalEmpIds.size > 0;
                            if (!showGuardiaSearch && !hasPinned) return null;
                            return (
                                <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl mb-1 relative">
                                    <Search size={12} className="text-indigo-400 shrink-0"/>
                                    <input
                                        type="text"
                                        placeholder="Nombre, apellido o legajo…"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        autoFocus
                                        className="bg-transparent text-[11px] font-bold outline-none flex-1 min-w-0 placeholder:text-indigo-300 text-indigo-800"
                                    />
                                    {hasPinned && (
                                        <div className="flex items-center gap-1">
                                            {[...pinnedExternalEmpIds].map(id => {
                                                const emp = employees.find((e: any) => e.id === id);
                                                if (!emp) return null;
                                                return (
                                                    <span key={id} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                                                        {emp.name.split(' ')[0]}
                                                        <button onClick={() => setPinnedExternalEmpIds(prev => { const s = new Set(prev); s.delete(id); return s; })} className="hover:text-indigo-900 leading-none ml-0.5"><X size={9}/></button>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {(searchTerm || showGuardiaSearch) && (
                                        <button onClick={() => { setSearchTerm(''); setShowGuardiaSearch(false); }} className="text-indigo-400 hover:text-indigo-600 shrink-0"><X size={12}/></button>
                                    )}
                                    {q.length >= 2 && (inGrid.length > 0 || external.length > 0) && (
                                        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl w-72 overflow-hidden max-h-72 overflow-y-auto">
                                            {inGrid.length > 0 && (
                                                <>
                                                    <div className="px-2.5 py-1.5 text-[9px] font-black uppercase text-slate-400 bg-slate-50 border-b border-slate-100">
                                                        En este cronograma
                                                    </div>
                                                    {inGrid.map((emp: any) => (
                                                        <button
                                                            key={`g-${emp.id}`}
                                                            className="w-full px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2"
                                                            onClick={() => { scrollToEmployeeRow(emp.id); setSearchTerm(''); }}
                                                        >
                                                            <User size={11} className="text-emerald-500 shrink-0"/>
                                                            <span className="truncate flex-1">{emp.name}</span>
                                                            {emp.fileNumber && <span className="text-[9px] font-mono text-slate-400">{emp.fileNumber}</span>}
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                            {external.length > 0 && (
                                                <>
                                                    <div className="px-2.5 py-1.5 text-[9px] font-black uppercase text-slate-400 bg-slate-50 border-b border-slate-100">
                                                        Agregar al cronograma
                                                    </div>
                                                    {external.map((emp: any) => (
                                                        <button
                                                            key={`x-${emp.id}`}
                                                            className="w-full px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2"
                                                            onClick={() => { setPinnedExternalEmpIds(prev => new Set([...prev, emp.id])); setSearchTerm(''); window.setTimeout(() => scrollToEmployeeRow(emp.id), 120); }}
                                                        >
                                                            <UserPlus size={11} className="text-indigo-400 shrink-0"/>
                                                            <span className="truncate flex-1">{emp.name}</span>
                                                            {emp.fileNumber && <span className="text-[9px] font-mono text-slate-400">{emp.fileNumber}</span>}
                                                        </button>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {q.length >= 2 && inGrid.length === 0 && external.length === 0 && (
                                        <span className="text-[10px] text-indigo-400 font-bold">Sin resultados</span>
                                    )}
                                </div>
                            );
                        })()}
                        {comparingSnapshot ? (
                            <div className="flex h-full min-h-0 flex-col gap-0.5 p-0.5">
                                {compareSnapshotSparse && (
                                    <div className="shrink-0 px-2 py-1 rounded-lg bg-amber-50 border border-amber-300 text-[9px] font-bold text-amber-900">
                                        Esta versión antigua solo guardó celdas modificadas (no el mes completo). Los próximos GUARDAR ya dejan el histórico completo. «Solo cambios» solo filtra filas con diferencias.
                                    </div>
                                )}
                                <div className={`flex flex-1 min-h-0 gap-1 ${compareLayout === 'side' ? 'flex-col xl:flex-row' : 'flex-col'}`}>
                                <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border-2 border-amber-400 bg-white">
                                    <div className="shrink-0 px-2 py-0.5 bg-amber-100 border-b border-amber-200 flex items-center justify-between gap-2">
                                        <span className="text-[9px] font-black text-amber-900 uppercase flex items-center gap-1"><History size={10}/> Histórico</span>
                                        <span className="text-[8px] font-bold text-amber-700">Borde ámbar = cambió</span>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                                        {renderGrid(true, comparingSnapshot.data, compareDiffKeys, compareGridEmployees, compareGridOpts)}
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border-2 border-indigo-500 bg-white">
                                    <div className="shrink-0 px-2 py-0.5 bg-indigo-600 border-b border-indigo-700 flex items-center justify-between gap-2">
                                        <span className="text-[9px] font-black text-white uppercase flex items-center gap-1"><Activity size={10}/> Actual (en vivo)</span>
                                        <span className="text-[8px] font-bold text-indigo-100">Borde violeta = cambió</span>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                                        {renderGrid(false, undefined, compareDiffKeys, compareGridEmployees, compareGridOpts)}
                                    </div>
                                </div>
                                </div>
                            </div>
                        ) : (
                            <div className={`relative flex-1 min-h-0 overflow-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 transition-opacity duration-150 ${(isFilterPending || (selectedObjective && !shiftsMapLoaded)) ? 'opacity-70' : ''} ${correctionMode ? 'pb-2' : ''}`}>
                                {renderGrid(false, undefined, undefined, undefined, correctionMode ? { highlightCoverageFooter: true } : undefined)}
                            </div>
                        )}
                        </>
                    )}
                </div>

                {/* BARRA FLOTANTE */}
                {!comparingSnapshot && !isServiceLocked && allowPlanningMultiSelect && (
                    (clipboard !== null) ||
                    (selection.start !== null && (selection.start.r !== selection.end?.r || selection.start.c !== selection.end?.c))
                ) && (
                    <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-white rounded-xl shadow-2xl border border-slate-600 no-print animate-in zoom-in-95 ${bulkShowPerEmpPanel ? 'max-w-[min(98vw,1000px)]' : ''}`}>
                        {columnSelectMode ? (
                            <div className="flex gap-1 items-center p-2">
                                <span className="text-[10px] font-bold px-2 text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                                    <FastForward size={12}/> Copiar día {columnSelectSource !== null ? daysInMonth[columnSelectSource]?.getDate() : ''} →
                                </span>
                                <button
                                    onClick={applyColumnCopy}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-black text-xs flex items-center gap-1.5 shadow-sm"
                                >
                                    <ArrowRightCircle size={14}/> Pegar en selección
                                </button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => { setSelection({start:null, end:null}); setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false); }} className="p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                            </div>
                        ) : clipboard !== null ? (
                            <div className="flex gap-1 items-center p-2 flex-wrap">
                                <ClipboardPaste size={14} className="text-emerald-400 ml-1"/>
                                <span className="text-[10px] font-bold px-1 text-emerald-300 uppercase tracking-wider">
                                    Portapapeles {clipboardDim ? `${clipboardDim.rows}×${clipboardDim.cols}` : ''}{clipboardIsCut ? ' · cortado' : ' · se mantiene'}
                                </span>
                                <button
                                    onClick={() => { if (selection.start) { const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r); const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c); handlePasteAt(minR, minC); } }}
                                    disabled={!selection.start}
                                    title={selection.start ? 'Pegar en la selección (podés repetir)' : 'Seleccioná una celda o rango destino'}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-white font-black text-xs flex items-center gap-1.5 shadow-sm"
                                >
                                    <ArrowRightCircle size={14}/> Pegar aquí
                                </button>
                                <span className="text-[9px] text-slate-400 px-1">Ctrl+V</span>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => { setClipboard(null); setClipboardDim(null); }} className="p-2 hover:bg-slate-700 rounded-lg" title="Vaciar portapapeles"><X size={16}/></button>
                            </div>
                        ) : bulkShowPerEmpPanel ? (
                            <>
                                <div className="flex items-center gap-1.5 px-2 py-2 border-b border-slate-700/80">
                                    <span className="w-[148px] shrink-0 text-[9px] font-black text-indigo-300 uppercase tracking-wider">A todos</span>
                                    <div className="w-[88px] shrink-0 flex flex-wrap gap-0.5">
                                        {bulkPerEmpMode && selectedGrupo && bulkEffectiveStructure.filter((p: any) => !bulkBarVisiblePositionNames || bulkBarVisiblePositionNames.has(p.positionName)).map((p: any) => {
                                            const selected = bulkBarPosition === p.positionName;
                                            return (
                                                <button
                                                    key={`bulkpos_${p.positionName}`}
                                                    type="button"
                                                    onClick={() => setBulkBarPosition(selected ? null : p.positionName)}
                                                    disabled={isServiceLocked}
                                                    title={selected
                                                        ? `Paleta ${p.positionName} — elegí turno (no asigna puesto)`
                                                        : `Ver turnos del puesto ${p.positionName}`}
                                                    className={`px-1.5 h-6 rounded-lg font-black text-[9px] border max-w-[84px] truncate transition-colors ${
                                                        selected
                                                            ? 'bg-indigo-400 text-white border-indigo-200 ring-1 ring-indigo-300'
                                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400'
                                                    }`}
                                                >
                                                    {abbrevPlanningPositionName(p.positionName, 5)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-0.5 items-center shrink-0">
                                        {bulkPanelShiftColumns.map((code) => {
                                            if (code === 'RET') {
                                                return (
                                                    <button key="all_RET" type="button" onClick={() => applyBulkChange({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', positionName: 'Retén' })} disabled={isServiceLocked} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('RET')}`}>RET</button>
                                                );
                                            }
                                            if (code === 'F') {
                                                return (
                                                    <button key="all_F" type="button" onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' })} disabled={isServiceLocked} className="w-7 h-6 rounded bg-green-500 text-white font-black text-[9px]">F</button>
                                                );
                                            }
                                            if (code === 'REF') {
                                                return (
                                                    <button key="all_REF" type="button" onClick={() => openBulkDeployPicker('SURPLUS')} disabled={isServiceLocked} title="Refuerzo — elegí banda del puesto" className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('REF')}`}>REF</button>
                                                );
                                            }
                                            if (code === 'ESC') {
                                                return (
                                                    <button key="all_ESC" type="button" onClick={() => openBulkDeployPicker('TRAINING')} disabled={isServiceLocked} title="Escuela — elegí banda real del puesto" className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('ESC')}`}>ESC</button>
                                                );
                                            }
                                            const pool = bulkHeaderShiftPool;
                                            const s = pool.find((x: any) => String(x.code || '').toUpperCase() === code);
                                            if (!s) return <span key={`all_sp_${code}`} className="w-7 h-6 shrink-0" aria-hidden />;
                                            return (
                                                <button key={`all_${code}`} type="button" onClick={() => applyBulkChange({ code: s.code, name: s.name, hours: s.hours, startTime: s.startTime, endTime: s.endTime })} disabled={isServiceLocked} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle(s.code)}`}>{s.code}</button>
                                            );
                                        })}
                                    </div>
                                    <div className="ml-auto flex items-center gap-0.5 shrink-0">
                                        <div className="h-5 w-px bg-slate-600 mx-0.5" />
                                        <button onClick={handleCopySelection} title="Copiar" className="p-1.5 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-indigo-200"><Copy size={13}/></button>
                                        <button onClick={cutSelection} disabled={isServiceLocked} className="p-1.5 bg-violet-700 hover:bg-violet-600 rounded-lg text-violet-100"><Scissors size={13}/></button>
                                        <button onClick={undoLastPending} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300"><Undo size={13}/></button>
                                        <button onClick={() => setShowRRHHModal(true)} disabled={isServiceLocked} className="p-1.5 bg-amber-600 rounded-lg text-white"><FileText size={12}/></button>
                                        <button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="p-1.5 hover:bg-rose-600 rounded-lg text-rose-300"><Trash2 size={14}/></button>
                                        <button onClick={() => setSelection({start:null, end:null})} className="p-1.5 hover:bg-slate-700 rounded-lg"><X size={14}/></button>
                                    </div>
                                </div>
                                <div className="px-2 py-2 max-h-56 overflow-y-auto custom-scrollbar">
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5 px-0.5">
                                        <Users size={10} className="text-indigo-400"/> Por colaborador · ordenado por puesto
                                    </div>
                                    <div className="space-y-1">
                                        {bulkPanelEmployeesSorted.map((emp: any) => {
                                            const shortLabel = String(emp.name || '').split(',')[0]?.trim().slice(0, 18) || emp.name;
                                            if (bulkPerEmpMode && selectedGrupo) {
                                                const nativeObjId = resolveNativeObjectiveInGrupo(emp);
                                                const objId = nativeObjId || bulkEmpObjectiveOverrides[emp.id] || bulkTargetObjectiveId || selectedGrupo.objectiveIds[0] || '';
                                                const objIdx = selectedGrupo.objectiveIds.indexOf(objId);
                                                const objClr = GRUPO_COLOR_HEX[objIdx % GRUPO_COLOR_HEX.length] || '#64748b';
                                                const objShort = (selectedGrupo.objectiveNames[objIdx] || '').trim().split(/\s+/).filter((w: string) => w.length > 1).pop()?.slice(0, 6).toUpperCase() || '';
                                                const empShifts = getBulkEmpShifts(emp);
                                                const empShiftByCode = new Map(empShifts.map((s: any) => [String(s.code || '').toUpperCase(), s]));
                                                const empPos = empDefaultPos[`${emp.id}___${objId}`] || resolveBulkPanelEmpPosition(emp, objId) || '';
                                                return (
                                                    <div key={emp.id} className="flex items-center gap-1.5 rounded-lg bg-slate-900/50 px-1.5 py-1">
                                                        <span className="w-[148px] shrink-0 text-[9px] font-bold text-slate-200 truncate" title={emp.name}>{shortLabel}</span>
                                                        <div className="w-[88px] shrink-0 flex items-center gap-0.5 min-w-0">
                                                            {empPos && (
                                                                <span className="shrink-0 px-1 py-0.5 rounded bg-indigo-600 text-[7px] font-black text-white max-w-[40px] truncate" title={empPos}>
                                                                    {abbrevPlanningPositionName(empPos, 4)}
                                                                </span>
                                                            )}
                                                            {nativeObjId ? (
                                                                <span className="shrink-0 px-1 py-0.5 rounded text-[7px] font-black text-white" style={{ backgroundColor: objClr }}>{objShort}</span>
                                                            ) : (
                                                                <>
                                                                    <span className="shrink-0 px-1 py-0.5 rounded bg-amber-500 text-[7px] font-black text-white">EXT</span>
                                                                    <select value={objId} onChange={e => setBulkEmpObjectiveOverrides(prev => ({ ...prev, [emp.id]: e.target.value }))} className="h-6 w-full min-w-0 rounded border border-amber-400/50 bg-amber-950/60 text-amber-100 text-[8px] font-bold px-0.5 truncate">
                                                                        {selectedGrupo.objectiveIds.map((oid: string, oi: number) => (<option key={oid} value={oid}>{selectedGrupo.objectiveNames[oi]}</option>))}
                                                                    </select>
                                                                </>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-0.5 items-center shrink-0">
                                                            {bulkPanelShiftColumns.map((code) => {
                                                                if (code === 'RET') {
                                                                    return (
                                                                        <button key={`${emp.id}_RET`} type="button" onClick={() => applyBulkChange({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', positionName: 'Retén' }, { onlyEmpId: emp.id })} disabled={isServiceLocked} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('RET')}`}>RET</button>
                                                                    );
                                                                }
                                                                if (code === 'F') {
                                                                    return (
                                                                        <button key={`${emp.id}_F`} type="button" onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' }, { onlyEmpId: emp.id })} disabled={isServiceLocked} className="w-7 h-6 rounded bg-green-600 text-white text-[9px] font-black">F</button>
                                                                    );
                                                                }
                                                                if (code === 'REF') {
                                                                    return (
                                                                        <button key={`${emp.id}_REF`} type="button" onClick={() => openBulkDeployPicker('SURPLUS', { onlyEmpId: emp.id, positionName: empPos || undefined })} disabled={isServiceLocked || !empPos} title={!empPos ? 'Sin puesto asignado' : `${emp.name} · REF en ${empPos}`} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('REF')} ${!empPos ? 'opacity-30 cursor-not-allowed' : ''}`}>REF</button>
                                                                    );
                                                                }
                                                                if (code === 'ESC') {
                                                                    return (
                                                                        <button key={`${emp.id}_ESC`} type="button" onClick={() => openBulkDeployPicker('TRAINING', { onlyEmpId: emp.id, positionName: empPos || undefined })} disabled={isServiceLocked || !empPos} title={!empPos ? 'Sin puesto asignado' : `${emp.name} · ESC en ${empPos}`} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('ESC')} ${!empPos ? 'opacity-30 cursor-not-allowed' : ''}`}>ESC</button>
                                                                    );
                                                                }
                                                                const s = empShiftByCode.get(code);
                                                                if (!s) return <span key={`${emp.id}_sp_${code}`} className="w-7 h-6 shrink-0" aria-hidden />;
                                                                const _cov1 = isBulkCovBlocked(emp.id, empPos, (s as any).code);
                                                                return (
                                                                    <button key={`${emp.id}_${code}`} type="button" onClick={() => applyBulkChange({ code: s.code, name: s.name, hours: s.hours, startTime: s.startTime, endTime: s.endTime }, { onlyEmpId: emp.id })} disabled={isServiceLocked || _cov1} title={_cov1 ? 'Cobertura: turno no permitido para este empleado' : `${emp.name} · ${empPos || 'puesto'} → ${s.code}`} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle(s.code)} ${_cov1 ? 'opacity-30 cursor-not-allowed' : ''}`}>{s.code}</button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            const posName = resolveBulkPanelEmpPosition(emp);
                                            const empShifts = getBulkEmpShifts(emp);
                                            const empShiftByCode = new Map(empShifts.map((s: any) => [String(s.code || '').toUpperCase(), s]));
                                            const panelStructure = bulkMonoPositionInfo.structure || bulkEffectiveStructure || positionStructure || [];
                                            const filterPos = bulkEmpPositionFilter[emp.id] || null;
                                            // posName válido solo si el puesto aún existe en el SLA actual (evita badge obsoleto)
                                            const effectivePosName = posName && panelStructure.some((p: any) => p.positionName === posName) ? posName : null;
                                            const isSinglePosSla = panelStructure.length === 1;
                                            const hasAssignPos = !!effectivePosName || !!filterPos || !!bulkBarPosition || isSinglePosSla;
                                            return (
                                                <div key={emp.id} className="flex items-center gap-1.5 rounded-lg bg-slate-900/50 px-1.5 py-1">
                                                    <span className="w-[148px] shrink-0 text-[9px] font-bold text-slate-200 truncate" title={emp.name}>{shortLabel}</span>
                                                    <div className="w-[88px] shrink-0 flex flex-wrap items-center gap-0.5 min-w-0">
                                                        {effectivePosName ? (
                                                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-indigo-600 text-[8px] font-black text-white max-w-[84px] truncate" title={effectivePosName}>
                                                                {abbrevPlanningPositionName(effectivePosName, 8)}
                                                            </span>
                                                        ) : panelStructure.length > 1 ? (
                                                            panelStructure.filter((p: any) => {
                                                                if (!activeSlaPositionAssignments?.length) return true;
                                                                const _pa = activeSlaPositionAssignments.find((a: any) => a.employeeId === emp.id);
                                                                if (!_pa?.slots?.length) return true;
                                                                return _pa.slots.some((sl: any) => sl.positionName === p.positionName);
                                                            }).map((p: any) => {
                                                                const selected = filterPos === p.positionName;
                                                                return (
                                                                    <button
                                                                        key={`${emp.id}_pickpos_${p.positionName}`}
                                                                        type="button"
                                                                        disabled={isServiceLocked}
                                                                        title={selected
                                                                            ? `Paleta ${p.positionName} — elegí turno`
                                                                            : `Ver turnos del puesto ${p.positionName}`}
                                                                        onClick={() => {
                                                                            setBulkEmpPositionFilter(prev => {
                                                                                const next = { ...prev };
                                                                                if (selected) delete next[emp.id];
                                                                                else next[emp.id] = p.positionName;
                                                                                return next;
                                                                            });
                                                                        }}
                                                                        className={`shrink-0 px-1 py-0.5 rounded text-[7px] font-black border transition-colors ${
                                                                            selected
                                                                                ? 'bg-indigo-400 text-white border-indigo-200'
                                                                                : 'bg-slate-700 hover:bg-indigo-600 text-slate-200 border-slate-500'
                                                                        }`}
                                                                    >
                                                                        {abbrevPlanningPositionName(p.positionName, 4)}
                                                                    </button>
                                                                );
                                                            })
                                                        ) : isSinglePosSla ? (
                                                            <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-600 text-[8px] font-black text-slate-300 max-w-[84px] truncate" title={panelStructure[0].positionName}>
                                                                {abbrevPlanningPositionName(panelStructure[0].positionName, 8)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[7px] text-amber-400 font-bold">Sin puesto</span>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-0.5 items-center shrink-0">
                                                        {bulkPanelShiftColumns.map((code) => {
                                                            if (code === 'RET') {
                                                                return (
                                                                    <button key={`${emp.id}_RET`} type="button" onClick={() => applyBulkChange({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', positionName: 'Retén' }, { onlyEmpId: emp.id })} disabled={isServiceLocked} className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle('RET')}`}>RET</button>
                                                                );
                                                            }
                                                            if (code === 'F') {
                                                                return (
                                                                    <button key={`${emp.id}_F`} type="button" onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' }, { onlyEmpId: emp.id })} disabled={isServiceLocked} className="w-7 h-6 rounded bg-green-600 text-white text-[9px] font-black">F</button>
                                                                );
                                                            }
                                                            if (code === 'REF' || code === 'ESC') {
                                                                const intent = code === 'ESC' ? 'TRAINING' as const : 'SURPLUS' as const;
                                                                const posForDeploy = effectivePosName || filterPos || bulkBarPosition || (isSinglePosSla ? panelStructure[0]?.positionName : '') || '';
                                                                return (
                                                                    <button
                                                                        key={`${emp.id}_${code}`}
                                                                        type="button"
                                                                        onClick={() => openBulkDeployPicker(intent, { onlyEmpId: emp.id, positionName: posForDeploy || undefined })}
                                                                        disabled={isServiceLocked || !posForDeploy}
                                                                        title={!posForDeploy ? 'Elegí puesto primero' : `${emp.name} · ${code} en ${posForDeploy}`}
                                                                        className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle(code)} ${!posForDeploy ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                                    >
                                                                        {code}
                                                                    </button>
                                                                );
                                                            }
                                                            const s = empShiftByCode.get(code);
                                                            if (!s) return <span key={`${emp.id}_sp_${code}`} className="w-7 h-6 shrink-0" aria-hidden />;
                                                            const needsPos = !hasAssignPos && code !== 'RET' && code !== 'F';
                                                            const activePos = effectivePosName || filterPos || bulkBarPosition || (isSinglePosSla ? panelStructure[0]?.positionName : '') || '';
                                                            return (
                                                                <button
                                                                    key={`${emp.id}_${code}`}
                                                                    type="button"
                                                                    onClick={() => applyBulkChange({
                                                                        code: s.code,
                                                                        name: s.name,
                                                                        hours: s.hours,
                                                                        startTime: s.startTime,
                                                                        endTime: s.endTime,
                                                                    }, { onlyEmpId: emp.id })}
                                                                    disabled={isServiceLocked || needsPos || isBulkCovBlocked(emp.id, activePos, (s as any).code) || bulkMonoDisabledCodes.has(String((s as any).code || '').toUpperCase())}
                                                                    title={isBulkCovBlocked(emp.id, activePos, (s as any).code) ? 'Cobertura: turno no permitido para este empleado' : bulkMonoDisabledCodes.has(String((s as any).code || '').toUpperCase()) ? `Cupo completo: ${bulkMonoDisabledCodes.get(String((s as any).code || '').toUpperCase())}` : needsPos ? 'Elegí puesto (paleta) primero' : `${emp.name} · ${activePos || 'puesto'} → ${s.code}`}
                                                                    className={`w-7 h-6 rounded font-black text-[9px] ${getDefaultStyle(s.code)} ${(needsPos || isBulkCovBlocked(emp.id, activePos, (s as any).code) || bulkMonoDisabledCodes.has(String((s as any).code || '').toUpperCase())) ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                                >
                                                                    {s.code}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="flex gap-1 items-center p-2 flex-wrap">
                                <span className="text-[10px] font-bold px-2 text-slate-300 uppercase tracking-wider">Asignar:</span>
                                {selectedGrupo && grupoUnifiedMode && bulkBarScopeObjectiveId && (() => {
                                    const oi = selectedGrupo.objectiveIds.indexOf(bulkBarScopeObjectiveId);
                                    const clr = GRUPO_COLOR_HEX[oi % GRUPO_COLOR_HEX.length] || '#64748b';
                                    const nm = (selectedGrupo.objectiveNames[oi] || '').trim().split(/\s+/).filter((w: string) => w.length > 1).pop()?.slice(0, 8).toUpperCase()
                                        || (selectedGrupo.objectiveNames[oi] || '').slice(0, 8).toUpperCase()
                                        || 'OBJ';
                                    return (
                                        <span
                                            className="px-1.5 h-7 rounded-lg text-[8px] font-black text-white flex items-center"
                                            style={{ backgroundColor: clr }}
                                            title={selectedGrupo.objectiveNames[oi] || bulkBarScopeObjectiveId}
                                        >
                                            {nm}
                                        </span>
                                    );
                                })()}
                                {!bulkMonoPositionInfo.showPositionButtons && bulkMonoPositionInfo.effectivePos && (
                                    <span
                                        className="px-2 h-7 rounded-lg bg-slate-700 border border-slate-500 text-[9px] font-black text-indigo-200 max-w-[88px] truncate flex items-center"
                                        title={`Puesto: ${bulkMonoPositionInfo.effectivePos}`}
                                    >
                                        {abbrevPlanningPositionName(bulkMonoPositionInfo.effectivePos, 8)}
                                    </span>
                                )}
                                {bulkMonoPositionInfo.showPositionButtons && (
                                    <>
                                        <span className="text-[8px] font-black text-indigo-300 uppercase tracking-wider px-0.5">Puesto</span>
                                        {bulkEffectiveStructure.filter((p: any) => !bulkBarVisiblePositionNames || bulkBarVisiblePositionNames.has(p.positionName)).map((p: any) => {
                                            const selected = bulkBarPosition === p.positionName;
                                            return (
                                                <button
                                                    key={`bulkpos_${p.positionName}`}
                                                    type="button"
                                                    onClick={() => setBulkBarPosition(selected ? null : p.positionName)}
                                                    disabled={isServiceLocked}
                                                    title={selected
                                                        ? `Puesto ${p.positionName} seleccionado — ahora elegí el turno`
                                                        : `Elegir puesto ${p.positionName}, después el turno`}
                                                    className={`px-2 h-8 rounded-lg font-black text-[10px] border max-w-[72px] truncate transition-colors ${
                                                        selected
                                                            ? 'bg-indigo-400 text-white border-indigo-200 ring-2 ring-indigo-300'
                                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400'
                                                    }`}
                                                >
                                                    {abbrevPlanningPositionName(p.positionName, 5)}
                                                </button>
                                            );
                                        })}
                                        <div className="h-6 w-px bg-slate-600 mx-0.5" />
                                    </>
                                )}
                                {bulkMonoPositionInfo.showPositionButtons && !bulkMonoPositionInfo.effectivePos && (
                                    <span className="text-[8px] font-bold text-amber-300/90 px-1">Elegí puesto →</span>
                                )}
                                {(bulkMonoPositionInfo.effectivePos || !bulkMonoPositionInfo.showPositionButtons) && bulkMonoShifts.map((s: any) => {
                                    const code = String(s.code || '').toUpperCase();
                                    const covReason = bulkMonoDisabledCodes.get(code);
                                    const disabled = isServiceLocked || !!covReason;
                                    const title = covReason
                                        ? covReason
                                        : (s.positionName
                                            ? `${s.code} · puesto ${s.positionName}`
                                            : `${s.code} · se asigna al puesto dueño del turno en el SLA`);
                                    return (
                                        <button
                                            key={`${code}_${s.positionName || 'any'}`}
                                            onClick={() => {
                                                if (disabled) return;
                                                applyBulkChange({
                                                    code: s.code,
                                                    name: s.name,
                                                    hours: s.hours,
                                                    startTime: s.startTime,
                                                    endTime: s.endTime,
                                                });
                                            }}
                                            disabled={disabled}
                                            title={title}
                                            className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle(s.code)} ${disabled ? 'opacity-35 grayscale cursor-not-allowed' : ''}`}
                                        >
                                            {s.code}
                                        </button>
                                    );
                                })}
                                <button
                                    onClick={() => applyBulkChange({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', positionName: 'Retén' })}
                                    disabled={isServiceLocked}
                                    title="Retén — guardia disponible sin turno asignado (no suma cobertura SLA)"
                                    className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle('RET') || 'bg-amber-100 text-amber-800 border border-amber-300'}`}
                                >
                                    RET
                                </button>
                                <button
                                    onClick={() => openBulkDeployPicker('SURPLUS')}
                                    disabled={isServiceLocked}
                                    title="Refuerzo — elegí la banda real del puesto"
                                    className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle('REF') || 'bg-violet-100 text-violet-800 border border-violet-300'}`}
                                >
                                    REF
                                </button>
                                <button
                                    onClick={() => openBulkDeployPicker('TRAINING')}
                                    disabled={isServiceLocked}
                                    title="Escuela — elegí el turno real del puesto (no M/T/N genéricos)"
                                    className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle('ESC') || 'bg-sky-100 text-sky-800 border border-sky-300'}`}
                                >
                                    ESC
                                </button>
                                <button onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' })} disabled={isServiceLocked} className="w-8 h-8 rounded-lg bg-green-500 text-white font-black text-xs border border-green-600">F</button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={handleCopySelection} title="Copiar (Ctrl+C)" className="p-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-indigo-200 hover:text-white transition-colors flex items-center gap-1">
                                    <Copy size={14}/><span className="text-[9px] font-bold">Copiar</span>
                                </button>
                                <button onClick={cutSelection} disabled={isServiceLocked} title="Cortar (Ctrl+X)" className="p-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-lg text-violet-100 hover:text-white transition-colors flex items-center gap-1">
                                    <Scissors size={14}/><span className="text-[9px] font-bold">Cortar</span>
                                </button>
                                <button onClick={undoLastPending} title="Deshacer (Ctrl+Z)" className="p-2 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1">
                                    <Undo size={14}/><span className="text-[9px] font-bold">Z</span>
                                </button>
                                <span className="text-[8px] text-slate-500 px-1 hidden lg:inline">Ctrl+C/X/V/Z</span>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => setShowRRHHModal(true)} disabled={isServiceLocked} className="p-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-white font-bold text-xs flex items-center gap-2 shadow-sm"><FileText size={12}/> +Ausencia</button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="p-2 hover:bg-rose-600 rounded-lg text-rose-300 hover:text-white transition-colors" title="Borrar"><Trash2 size={16}/></button>
                                <button onClick={() => setSelection({start:null, end:null})} className="ml-1 p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                            </div>
                        )}
                    </div>
                )}

                {/* RESUMEN DE HORAS PLANIFICADAS */}
                {selectedObjective && !comparingSnapshot && Object.keys(empMonthlyHours).length > 0 && (
                    statsBarCollapsed ? (
                        <div className="rounded-xl border shadow-sm shrink-0 no-print flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><BarChart2 size={11}/> Estadísticas ocultas</span>
                            <button onClick={() => { setStatsBarCollapsed(false); if (typeof window !== 'undefined') localStorage.setItem('planif_stats_collapsed', '0'); }} className="flex items-center gap-1 px-2 py-1 text-[9px] font-black text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors" title="Mostrar estadísticas"><ChevronUp size={10}/> Mostrar</button>
                        </div>
                    ) : (() => {
                    const sourceHours = hoursMode === 'cct' ? empCctCurrentHours : empMonthlyHours;
                    const totalHrs = Object.values(sourceHours).reduce((a: number, b: any) => a + (b || 0), 0);
                    const slaCloseHours = hoursMode === 'mes' ? objectiveMonthSlaBaseHours : totalHrs;
                    const facturableTotalHrs = totalHrs;
                    const nativeAssignedHours = displayedEmployees
                        .filter((emp: any) => isEmployeeNativeToObjective(emp))
                        .reduce((sum: number, emp: any) => sum + (sourceHours[emp.id] || 0), 0);
                    const empCount = planningDotacionEmployees.length;
                    const empCountBillable = objectiveMonthShiftMetrics.empCountBillable;
                    const effectiveSlaVendidas = (selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0) ? grupoTotalVendidas : slaVendidas;
                    const slaMismatch = effectiveSlaVendidas > 0 && Math.round(facturableTotalHrs) !== Math.round(effectiveSlaVendidas);
                    const hsLabel = hoursMode === 'cct' ? 'Hs. CCT' : (effectiveSlaVendidas > 0 ? 'Hs. total' : 'Hs. Plan.');
                    const hsTitle = hoursMode === 'cct'
                        ? 'Suma del ciclo CCT actual (cola del mes anterior 26..fin + días 1..25 del mes activo). Solo turnos publicados de este objetivo, sin RET/REF/ESC/francos/licencias.'
                        : effectiveSlaVendidas > 0
                            ? 'Horas facturables del mes (= suma columnas legajo): base del cronograma + extensiones/adelantos de cobertura. El cierre «base SLA» sin ext/adel se ve en Desglose o Análisis por guardia.'
                            : 'Suma facturable por legajo (= Pre-factura CRM). Días 🚫 sin servicio no suman.';
                    const displayPlanHrs = facturableTotalHrs;
                    // Extras del mes (RFZ + TURA) de este objetivo — se facturan en CRM aparte del SLA base.
                    const monthPrefixExtras = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                    const extrasList = [
                        ...rfzTodos.filter((r: any) => r.objectiveId === selectedObjective && String(r.fecha || '').startsWith(monthPrefixExtras)),
                        ...Object.values(turaMap).filter((t: any) => t.objectiveId === selectedObjective && String(t.fecha || '').startsWith(monthPrefixExtras)),
                    ];
                    const extrasHrs = extrasList.reduce((a: number, t: any) => a + (Number(t.hours) || 0), 0);
                    const extrasCount = extrasList.length;
                    const slaDelta = effectiveSlaVendidas > 0 ? Math.round(effectiveSlaVendidas - facturableTotalHrs) : 0;
                    const extAdelBarHrs = hoursMode === 'mes' ? Math.max(0, Math.round((facturableTotalHrs - slaCloseHours) * 10) / 10) : 0;
                    const showHoursToggle = hoursMode === 'mes' && effectiveSlaVendidas > 0;
                    const persistStatsHoursView = (v: 'total' | 'detalle') => {
                        setStatsHoursView(v);
                        if (typeof window !== 'undefined') localStorage.setItem('planif_stats_hours_view', v);
                    };
                    const metricBox = 'shrink-0 rounded-md border border-slate-200/90 dark:border-slate-600/80 bg-white/90 dark:bg-slate-800/50 px-1.5 py-0.5 flex flex-col items-center justify-center leading-none';
                    const metricLabel = 'text-[7px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
                    const metricValue = 'text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100';
                    const hoursShell = slaMismatch
                        ? 'border-rose-300/80 bg-rose-50/40 dark:bg-rose-950/20'
                        : 'border-slate-200/90 dark:border-slate-600/80 bg-white/90 dark:bg-slate-800/50';
                    return (
                    <div className="rounded-lg border shadow-sm shrink-0 no-print px-2 py-1 flex flex-nowrap items-center justify-center gap-1 overflow-x-auto max-w-full" data-planning-summary-bar onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                        <div className={`${metricBox} min-w-[2.25rem]`} title="Total guardias en dotación activa para este objetivo (sin REF/ESC de reserva).">
                            <p className={metricLabel}>Empl.</p>
                            <p className={metricValue}>{empCount}</p>
                        </div>
                        <div
                            className={`shrink-0 flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 max-w-[min(100%,22rem)] ${hoursShell}`}
                            title={hsTitle}
                        >
                            <p className={`${metricLabel} whitespace-nowrap shrink-0`}>
                                {hsLabel}
                                {hoursMode === 'cct' && <span className="normal-case text-indigo-600 ml-0.5">CCT</span>}
                            </p>
                            {showHoursToggle && (
                                <div className="flex rounded border border-slate-200 dark:border-slate-600 p-px bg-slate-100/90 dark:bg-slate-900/60 shrink-0" role="tablist" aria-label="Vista de horas">
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={statsHoursView === 'total'}
                                        onClick={(e) => { e.stopPropagation(); persistStatsHoursView('total'); }}
                                        className={`px-1 py-px rounded-[3px] text-[7px] font-semibold leading-none transition-colors ${statsHoursView === 'total' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500'}`}
                                    >
                                        Total
                                    </button>
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={statsHoursView === 'detalle'}
                                        onClick={(e) => { e.stopPropagation(); persistStatsHoursView('detalle'); }}
                                        className={`px-1 py-px rounded-[3px] text-[7px] font-semibold leading-none transition-colors ${statsHoursView === 'detalle' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500'}`}
                                    >
                                        Desglose
                                    </button>
                                </div>
                            )}
                            {statsHoursView === 'total' || !showHoursToggle ? (
                                <p className={`${metricValue} whitespace-nowrap shrink-0 ${slaMismatch ? 'text-rose-700 dark:text-rose-400' : 'text-indigo-700 dark:text-indigo-300'}`}>
                                    {displayPlanHrs.toFixed(0)}<span className="text-[9px] font-medium text-slate-500">h</span>
                                </p>
                            ) : (
                                <p className="text-[7px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap truncate tabular-nums leading-tight" title="Base SLA (sin ext/adel) + extensiones = total facturable vs vendidas">
                                    Base {slaCloseHours.toFixed(0)}h
                                    {extAdelBarHrs > 0 ? ` · +${extAdelBarHrs} ext` : ''}
                                    {` · Tot ${facturableTotalHrs.toFixed(0)}h`}
                                    {effectiveSlaVendidas > 0 ? ` · Vend ${effectiveSlaVendidas}h` : ''}
                                    {slaMismatch ? (slaDelta > 0 ? ` · Δ −${slaDelta}h` : ` · Δ +${Math.abs(slaDelta)}h`) : ''}
                                </p>
                            )}
                        </div>
                        {empCountBillable > 0 && (
                            <div className={`${metricBox} min-w-[2.5rem]`} title={hoursMode === 'cct' ? 'Promedio de horas por empleado de dotación propia del objetivo en el ciclo CCT (excluye invitados/cobertura externa y guardias solo-RET).' : 'Promedio de horas por empleado de dotación propia del objetivo en el mes (excluye invitados/cobertura externa y guardias solo-RET).'}>
                                <p className={metricLabel}>Prom./emp.</p>
                                <p className={metricValue}>{Math.round(nativeAssignedHours / empCountBillable)}<span className="text-[9px] text-slate-500">h</span></p>
                            </div>
                        )}
                        {retCount > 0 && (
                            <div className={`${metricBox} min-w-[2.25rem]`} title="Días RET: guardia sobrante en el objetivo (0 h planificadas/liquidables). Disponible para cubrir otro servicio.">
                                <p className={metricLabel}>Retenes</p>
                                <p className={`${metricValue} text-amber-700`}>{retCount}<span className="text-[8px] text-amber-600">d</span></p>
                            </div>
                        )}
                        {retBufferHours > 0 && (
                            <div className={`${metricBox} min-w-[2.5rem]`} title="Colchón teórico RET → ~8h facturables (cupo calendario).">
                                <p className={metricLabel}>Colchón</p>
                                <p className={`${metricValue} text-emerald-700`}>{retBufferHours}h</p>
                            </div>
                        )}
                        {autoV2GenStats && autoCycles.length > 0 && (
                            <div className={`${metricBox} max-w-[4rem]`} title="Esquema(s) de ciclo aplicados en la generación automática.">
                                <p className={metricLabel}>Esquema</p>
                                <p className="text-[9px] font-semibold text-slate-700 dark:text-slate-200 truncate w-full text-center">{autoCycles.join('·')}</p>
                            </div>
                        )}
                        {autoV2GenStats?.excessPositionEmployees && autoV2GenStats.excessPositionEmployees.length > 0 && (
                            <div
                                className={`${metricBox} min-w-[2.25rem] cursor-default`}
                                title={autoV2GenStats.excessPositionEmployees.map(e => `${e.positionName}: ${e.assigned} asignados, necesita ${e.needed} (sobran ${e.excess})`).join('\n')}
                            >
                                <p className={`${metricLabel} text-amber-600`}>Pers.</p>
                                <p className={`${metricValue} text-amber-700`}>
                                    +{autoV2GenStats.excessPositionEmployees.reduce((s, e) => s + e.excess, 0)}
                                </p>
                            </div>
                        )}
                        {autoV2GenStats && (
                            <button
                                type="button"
                                onClick={() => setShowCapacityModal(true)}
                                className={`${metricBox} min-w-[2.25rem] hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors`}
                                title="Ver capacidad CCT por empleado."
                            >
                                <p className={metricLabel}>CCT</p>
                                <p className="text-[9px] font-semibold text-indigo-600">Ver</p>
                            </button>
                        )}
                        {extrasCount > 0 && (
                            <div className={`${metricBox} min-w-[2.5rem]`} title={`Refuerzos RFZ+TURA: ${extrasCount} turno(s), ${extrasHrs.toFixed(0)}h.`}>
                                <p className={metricLabel}>Extras</p>
                                <p className={`${metricValue} text-rose-700`}>+{extrasHrs.toFixed(0)}h</p>
                            </div>
                        )}
                        {effectiveSlaVendidas > 0 && statsHoursView === 'total' && (
                            <div className={`${metricBox} min-w-[2.5rem] ${slaMismatch ? 'border-teal-200/90' : ''}`}>
                                <p className={metricLabel}>SLA vend.</p>
                                <p className={`${metricValue} text-teal-800 dark:text-teal-300`}>{effectiveSlaVendidas}</p>
                            </div>
                        )}
                        {planningAuxiliarySummary?.hasEnc && (
                            <div className={`${metricBox} min-w-[2.75rem]`} title={`Encargado: ${planningAuxiliarySummary.encPlanned}h planificadas · techo ${planningAuxiliarySummary.encContract}h${planningAuxiliarySummary.encInSla > 0 ? ` (${planningAuxiliarySummary.encInSla}h en SLA vendido)` : ' (fuera de SLA vendido)'}`}>
                                <p className={`${metricLabel} text-amber-700`}>ENC</p>
                                <p className={`${metricValue} text-amber-800`}>{planningAuxiliarySummary.encPlanned}<span className="text-[8px] text-slate-500">/{planningAuxiliarySummary.encContract}</span></p>
                            </div>
                        )}
                        {(planningAuxiliarySummary?.hasEvt || (planningAuxiliarySummary?.evtPlanned ?? 0) > 0) && (
                            <div className={`${metricBox} min-w-[2.5rem]`} title="Eventos / extras TURA — prefactura, fuera de SLA cobertura">
                                <p className={`${metricLabel} text-violet-700`}>EVT</p>
                                <p className={`${metricValue} text-violet-800`}>{planningAuxiliarySummary?.evtPlanned ?? 0}</p>
                            </div>
                        )}
                        {hoursMode === 'mes' && selectedObjective && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setShowHoursBreakdownModal(true); }}
                                className={`${metricBox} min-w-[2.75rem] hover:bg-indigo-50/80 dark:hover:bg-indigo-950/30 transition-colors border-indigo-200/70 dark:border-indigo-800`}
                                title="Detalle por guardia: columna legajo, base SLA, ext/adel y exclusiones"
                            >
                                <p className={metricLabel}>Análisis</p>
                                <p className="text-[9px] font-semibold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">Por guardia</p>
                            </button>
                        )}
                        <button type="button" onClick={() => { setStatsBarCollapsed(true); if (typeof window !== 'undefined') localStorage.setItem('planif_stats_collapsed', '1'); }} className="shrink-0 flex items-center justify-center w-6 h-6 text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:border-slate-600 rounded-md transition-colors" title="Ocultar estadísticas"><ChevronDown size={12}/></button>
                    </div>
                    );
                    })() )}

                {!comparingSnapshot && !statsBarCollapsed && (
                <div className="hidden lg:block rounded-xl border shadow-sm shrink-0 no-print overflow-hidden" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                    {/* Barra de título — siempre visible, clic abre el modal */}
                    <button
                        onClick={() => setShowActivityModal(true)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                        <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2">
                            <Clock size={11}/> Actividad Reciente
                            {unifiedLogs.length > 0 && (
                                <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded text-[9px]">{unifiedLogs.length}</span>
                            )}
                        </span>
                        <Maximize2 size={10} className="text-slate-400"/>
                    </button>
                    {/* Notificación de nueva actividad — aparece 60 s y luego se cierra */}
                    {latestLog && (
                        <div
                            className="border-t border-slate-100 dark:border-slate-700 px-3 py-1.5 flex items-center gap-2 text-[10px] cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-700 animate-in slide-in-from-bottom-1 transition-colors"
                            onClick={() => setShowActivityModal(true)}
                        >
                            <span className="font-mono text-slate-400 shrink-0">{new Date(latestLog.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            <span className="font-black uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">{latestLog.label}</span>
                            <span className="text-slate-600 dark:text-slate-300 truncate flex-1">{latestLog.detail}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); clearLatestLogNotification(); }}
                                className="shrink-0 text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-200"
                                title="Cerrar"
                            >
                                <X size={10}/>
                            </button>
                        </div>
                    )}
                </div>
                )}

                {showCompareDiffModal && comparingSnapshot && (
                    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowCompareDiffModal(false)}>
                        <div className="bg-white w-full max-w-2xl max-h-[75vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-3 border-b bg-slate-50 flex justify-between items-center gap-2">
                                <h3 className="font-black text-sm flex items-center gap-2"><ArrowLeftRight className="text-indigo-600" size={16}/> Diferencias · histórico → actual</h3>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${planningCompareDiff?.changedCount ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                        {planningCompareDiff?.changedCount ?? 0} celda(s)
                                    </span>
                                    <button onClick={() => setShowCompareDiffModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={16}/></button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 text-[11px] space-y-1">
                                {!planningCompareDiff?.changedCount ? (
                                    <p className="text-emerald-700 font-bold py-4 text-center">Sin diferencias: la versión actual coincide con el snapshot.</p>
                                ) : planningCompareDiff.cells.map((c) => {
                                    const emp = displayedEmployees.find((e: { id: string }) => e.id === c.empId);
                                    const label = emp?.name || c.empId.slice(0, 8);
                                    const arrow = c.histLabel && c.currentLabel ? `${c.histLabel} → ${c.currentLabel}` : c.currentLabel ? `∅ → ${c.currentLabel}` : `${c.histLabel} → ∅`;
                                    return (
                                        <div key={c.key} className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                                            <span className="truncate font-bold text-slate-800">{label} · {c.date.split('-').reverse().join('/')}</span>
                                            <span className="shrink-0 font-mono text-indigo-700">{arrow}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {showCompareSummaryModal && selectedObjective && Object.keys(empMonthlyHours).length > 0 && (() => {
                    const sourceHours = hoursMode === 'cct' ? empCctCurrentHours : empMonthlyHours;
                    const totalHrs = Object.values(sourceHours).reduce((a: number, b: any) => a + (b || 0), 0);
                    const nativeAssignedHours = displayedEmployees
                        .filter((emp: any) => isEmployeeNativeToObjective(emp))
                        .reduce((sum: number, emp: any) => sum + (sourceHours[emp.id] || 0), 0);
                    const empCount = planningDotacionEmployees.length;
                    const empCountBillable = objectiveMonthShiftMetrics.empCountBillable;
                    const effectiveSlaVendidas = (selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0) ? grupoTotalVendidas : slaVendidas;
                    const slaMismatch = effectiveSlaVendidas > 0 && Math.round(totalHrs) !== Math.round(effectiveSlaVendidas);
                    const hsLabel = hoursMode === 'cct' ? 'Hs. CCT' : 'Hs. Plan.';
                    return (
                    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowCompareSummaryModal(false)}>
                        <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-black text-sm flex items-center gap-2"><BarChart3 className="text-indigo-600" size={16}/> Resumen del mes</h3>
                                <button onClick={() => setShowCompareSummaryModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={16}/></button>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-3 text-center">
                                <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Empleados</p><p className="text-xl font-black text-slate-800">{empCount}</p></div>
                                <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">{hsLabel}</p><p className={`text-xl font-black ${slaMismatch ? 'text-rose-600' : 'text-indigo-600'}`}>{totalHrs.toFixed(0)}</p></div>
                                {empCountBillable > 0 && <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Prom./Emp.</p><p className="text-xl font-black text-slate-600">{Math.round(nativeAssignedHours / empCountBillable)}h</p></div>}
                                {effectiveSlaVendidas > 0 && <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Vendidas SLA</p><p className="text-xl font-black text-teal-600">{effectiveSlaVendidas}</p></div>}
                            </div>
                            <p className="px-4 pb-4 text-[10px] text-slate-500">Snapshot: {compareSnapshotLabel} · {planningCompareDiff?.changedCount ?? 0} celda(s) distinta(s) vs actual.</p>
                        </div>
                    </div>
                    );
                })()}

                {showActivityModal && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowActivityModal(false)}>
                        <div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-black text-lg flex items-center gap-2"><Clock className="text-indigo-600" size={18}/> Actividad Reciente</h3>
                                {empresaId && (
                                    <p className="text-[10px] font-bold text-slate-500 mt-0.5">Empresa: {(empresa as any)?.nombre || empresaId}</p>
                                )}
                                <button onClick={() => setShowActivityModal(false)} className="p-2 hover:bg-slate-200 rounded-lg"><X size={18}/></button>
                            </div>
                            {/* Tabs */}
                            <div className="flex border-b bg-white px-4 gap-1 pt-2">
                                <button
                                    onClick={() => setActivityTab('cambios')}
                                    className={`px-4 py-2 text-xs font-black uppercase rounded-t-lg transition-colors ${activityTab === 'cambios' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    Cambios cronograma {unifiedLogs.length > 0 && <span className="ml-1 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[9px]">{unifiedLogs.length}</span>}
                                </button>
                                <button
                                    onClick={() => setActivityTab('notifs')}
                                    className={`px-4 py-2 text-xs font-black uppercase rounded-t-lg transition-colors flex items-center gap-1 ${activityTab === 'notifs' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <Bell size={11}/> Notificaciones
                                    {notifLogs.filter(n => !n.ackedAt && (n.requiresAck || !n.read)).length > 0 && (
                                        <span className="ml-1 bg-rose-500 text-white px-1.5 py-0.5 rounded-full text-[9px]">
                                            {notifLogs.filter(n => n.requiresAck && !n.ackedAt).length > 0
                                                ? `${notifLogs.filter(n => n.requiresAck && !n.ackedAt).length} sin enterarse`
                                                : `${notifLogs.filter(n => !n.read).length} sin leer`}
                                        </span>
                                    )}
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                                {activityTab === 'cambios' ? (
                                    unifiedLogs.length === 0 ? (
                                        <div className="text-sm text-slate-400 italic">Sin actividad reciente.</div>
                                    ) : (
                                        unifiedLogs.map((log) => {
                                            const realName = usersMap[log.actorUid] || usersMap[log.actorEmail] || usersMap[log.actorName] || usersMap[log.actor] || log.actorName || log.actor || 'Sistema';
                                            return (
                                                <div key={log.id} className="p-3 border rounded-xl hover:bg-slate-50 transition-colors">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                                            <span className="text-xs font-mono text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                                                            <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded border">{log.label}</span>
                                                            {log.objectiveName && (
                                                                <span className="text-[10px] font-bold text-indigo-600 truncate max-w-[140px]">{log.objectiveName}</span>
                                                            )}
                                                            <span className="text-xs text-slate-700 truncate">{log.detail}</span>
                                                        </div>
                                                        <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{realName}</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )
                                ) : (
                                    notifLogs.length === 0 ? (
                                        <div className="text-sm text-slate-400 italic">Sin notificaciones a vigiladores.</div>
                                    ) : (
                                        notifLogs.map((n) => {
                                            const emp = employees.find(e => e.id === n.employeeId);
                                            const empName = emp?.name || n.employeeId || '—';
                                            const typeColors: Record<string, string> = {
                                                TURNO_NUEVO: 'bg-indigo-100 text-indigo-700',
                                                TURNO_MODIFICADO: 'bg-amber-100 text-amber-700',
                                                TURNO_ELIMINADO: 'bg-rose-100 text-rose-700',
                                                FRANCO_ASIGNADO: 'bg-emerald-100 text-emerald-700',
                                                CRONOGRAMA_PUBLICADO: 'bg-violet-100 text-violet-700',
                                                CONVOCATORIA_EVENTO: 'bg-yellow-100 text-yellow-800',
                                                EVENTO_CONFIRMADO: 'bg-emerald-100 text-emerald-800',
                                                EVENTO_DESAFECTADO: 'bg-rose-100 text-rose-800',
                                            };
                                            const typeLabel: Record<string, string> = {
                                                TURNO_NUEVO: 'Nuevo turno',
                                                TURNO_MODIFICADO: 'Modificado',
                                                TURNO_ELIMINADO: 'Eliminado',
                                                FRANCO_ASIGNADO: 'Franco',
                                                CRONOGRAMA_PUBLICADO: 'Cronograma',
                                                CONVOCATORIA_EVENTO: 'Convocatoria',
                                                EVENTO_CONFIRMADO: 'Evento OK',
                                                EVENTO_DESAFECTADO: 'Desafectado',
                                            };
                                            const pendingAck = !!(n.requiresAck || ['CRONOGRAMA_PUBLICADO','TURNO_NUEVO','TURNO_MODIFICADO','TURNO_ELIMINADO','FRANCO_ASIGNADO','CONVOCATORIA_EVENTO','EVENTO_CONFIRMADO','EVENTO_DESAFECTADO'].includes(n.type)) && !n.ackedAt;
                                            return (
                                                <div key={n.id} className={`p-3 border rounded-2xl shadow-sm transition-colors ${
                                                    pendingAck ? 'bg-amber-50 border-amber-200' : n.ackedAt ? 'bg-emerald-50/40 border-emerald-100' : n.read ? 'bg-white' : 'bg-indigo-50 border-indigo-200'
                                                }`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-start gap-2 min-w-0 flex-1">
                                                            <div className="mt-0.5 shrink-0">
                                                                {n.ackedAt
                                                                    ? <CheckCircle size={14} className="text-emerald-600"/>
                                                                    : pendingAck
                                                                        ? <Bell size={14} className="text-amber-600"/>
                                                                        : n.read
                                                                            ? <CheckCircle size={14} className="text-slate-400"/>
                                                                            : <Bell size={14} className="text-indigo-500"/>
                                                                }
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${typeColors[n.type] || 'bg-slate-100 text-slate-600'}`}>
                                                                        {typeLabel[n.type] || n.type}
                                                                    </span>
                                                                    <span className="text-xs font-bold text-slate-700">{empName}</span>
                                                                </div>
                                                                {n.title ? (
                                                                    <p className="text-[11px] font-semibold text-slate-800 truncate">{n.title}</p>
                                                                ) : null}
                                                                <p className="text-xs text-slate-600 truncate">{n.body}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-[10px] font-mono text-slate-400">{new Date(n.timestamp).toLocaleString()}</p>
                                                            {n.ackedAt ? (
                                                                <p className="text-[9px] text-emerald-700 font-black mt-0.5">
                                                                    ✓ Enterado {new Date(n.ackedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                                                </p>
                                                            ) : pendingAck ? (
                                                                <p className="text-[9px] text-amber-700 font-black mt-0.5">Pendiente «Me enteré»</p>
                                                            ) : n.read && n.readAt ? (
                                                                <p className="text-[9px] text-emerald-600 font-bold mt-0.5">
                                                                    ✓ Leído {new Date(n.readAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                                                </p>
                                                            ) : (
                                                                <p className="text-[9px] text-indigo-500 font-bold mt-0.5">Sin leer</p>
                                                            )}
                                                            {isSuperAdmin && n.employeeId ? (
                                                                <button
                                                                    type="button"
                                                                    className="mt-1 text-[9px] font-black uppercase text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline"
                                                                    onClick={async () => {
                                                                        try {
                                                                            const call = httpsCallable(functions, 'sendTestNotification');
                                                                            const res = await call({
                                                                                employeeId: n.employeeId,
                                                                                title: 'Prueba FCM (panel)',
                                                                                body: `Push de prueba para ${empName}. App cerrada = bandeja del sistema.`,
                                                                                type: 'SYSTEM_TEST',
                                                                            });
                                                                            const data = (res?.data || {}) as { successCount?: number; failureCount?: number };
                                                                            toast.success(`FCM → ${empName}: OK ${data.successCount || 0}${data.failureCount ? ` · fallidas ${data.failureCount}` : ''}`);
                                                                        } catch (e: any) {
                                                                            toast.error(e?.message || 'No se pudo enviar push de prueba');
                                                                        }
                                                                    }}
                                                                >
                                                                    Probar FCM
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* MODALES Y MENÚS DE CONTEXTO (V9.10 - EXPANDIDOS Y ORDENADOS) */}

                {/* 1. MODAL SELECTOR DE TURNOS */}
                {selectedCell && !showConflictModal && !showSwapModal && !showRRHHModal && !showVacancyModal && !pendingAssignment && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedCell(null)}>
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-[540px] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                            {(() => {
                                const employeeName = employees.find(e => e.id === selectedCell.empId)?.name || 'Empleado';
                                const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
                                const pending = pendingChanges[key];
                                const shift = selectedCell.currentShift;
                                const absence = selectedCell.absence;
                                const code = String(shift?.code || shift?.type || '').toUpperCase();
                                const isConsolidated = isShiftConsolidated(shift);
                                const isRRHHCode = ['V', 'L', 'PG', 'A', 'E', 'AA'].includes(code);
                                const isPastClosed = isPlanningDateLocked(selectedCell.dateStr);
                                const objectiveId = (shift?.objectiveId || selectedObjective || '').toString();
                                const serviceName = shift?.objectiveName || (objectiveId ? getObjectiveName(objectiveId) : '-');
                                const coveredPosition = (shift?.positionName || activePosition || 'General').toString();
                                const NON_ABSENCE_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'EN', 'FT', 'RET', 'REF', 'ESC', 'C']);
                                const resolveCoverageForAbsence = () => {
                                    const empName = employees.find(e => e.id === selectedCell.empId)?.name || '';
                                    const dateStr = selectedCell.dateStr;
                                    const titularLastName = empName.split(',')[0]?.trim().toLowerCase() || empName.toLowerCase();

                                    // 1. Recolectar todos los turnos del día que no sean del titular
                                    const candidates: any[] = [];
                                    if (cellTurnosMap) {
                                        for (const [k, arr] of Object.entries(cellTurnosMap)) {
                                            if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${selectedCell.empId}_`)) continue;
                                            if (Array.isArray(arr)) {
                                                for (const item of arr) {
                                                    if (item && !item.isDeleted && !candidates.some(c => c.id === item.id)) {
                                                        candidates.push(item);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    const allSources = { ...shiftsMap, ...pendingChanges };
                                    for (const [k, raw] of Object.entries(allSources)) {
                                        if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${selectedCell.empId}_`)) continue;
                                        const s = raw as any;
                                        if (s && !s.isDeleted && !candidates.some(c => c.id === s.id)) {
                                            candidates.push(s);
                                        }
                                    }

                                    const isVacancyCandidate = (c: any) => {
                                        if (!c) return true;
                                        if (c.employeeId === 'VACANTE' || c.isUnassigned === true) return true;
                                        const o = String(c.origin || '').toUpperCase();
                                        if (o.startsWith('VACANTE_') || o === 'SLA_VIRTUAL') return true;
                                        if (String(c.employeeName || '').toUpperCase() === 'VACANTE') return true;
                                        return false;
                                    };

                                    // 2. Nombre explícito desde Ops / plan (prioridad: no confundir con doc VACANTE)
                                    const coveredByRaw = shift?.coveredBy
                                        || shift?.coveredByEmployeeName
                                        || pending?.coveredBy
                                        || pending?.coveredByEmployeeName
                                        || absence?.coveredBy
                                        || absence?.coveredByEmployeeName;

                                    if (coveredByRaw) {
                                        const nameOnly = String(coveredByRaw).replace(/\s*\([^)]*\)\s*$/, '').trim();
                                        if (nameOnly && nameOnly.toUpperCase() !== 'VACANTE') {
                                            const matchedCandidate = candidates.find(c => {
                                                if (isVacancyCandidate(c)) return false;
                                                const cName = String(c.employeeName || employees.find(e => e.id === c.employeeId)?.name || '').toLowerCase();
                                                return cName.includes(nameOnly.toLowerCase()) || nameOnly.toLowerCase().includes(cName);
                                            });
                                            if (matchedCandidate) {
                                                return {
                                                    employeeName: matchedCandidate.employeeName || nameOnly,
                                                    code: String(matchedCandidate.code || '').toUpperCase(),
                                                    shift: matchedCandidate,
                                                    objectiveName: matchedCandidate.objectiveName || (matchedCandidate.objectiveId ? getObjectiveName(matchedCandidate.objectiveId) : serviceName),
                                                };
                                            }
                                            return { employeeName: nameOnly, code: '', shift: null, objectiveName: serviceName };
                                        }
                                    }

                                    // 3. Buscar turno de cobertura específico para este titular/ausencia
                                    //    (nunca docs VACANTE — esos son el hueco, no el cubridor)
                                    const ledgerEventId = String(shift?.coverageEventId || pending?.coverageEventId || absence?.coverageEventId || '').trim();
                                    for (const s of candidates) {
                                        if (isVacancyCandidate(s)) continue;

                                        if (ledgerEventId && String(s.coverageEventId || '') === ledgerEventId) {
                                            const covEmp = employees.find((e: any) => e.id === s.employeeId);
                                            const covName = covEmp?.name || s.employeeName || '—';
                                            if (String(covName).toUpperCase() === 'VACANTE') continue;
                                            return {
                                                employeeName: covName,
                                                code: String(s.code || '').toUpperCase(),
                                                shift: s,
                                                objectiveName: s.objectiveName || (s.objectiveId ? getObjectiveName(s.objectiveId) : serviceName),
                                            };
                                        }

                                        const coversName = String(s.coversAbsenceEmployeeName || s.absenceEmployeeName || s.coveredEmployeeName || '').toLowerCase();
                                        const coversEmpId = String(s.coversEmployeeId || '');
                                        const absShiftId = String(s.absenceShiftId || '');
                                        const causedShiftId = String(s.causedByShiftId || s.coverageSourceId || '');
                                        const comments = String(s.comments || '').toLowerCase();

                                        const matchesName = coversName && (coversName.includes(titularLastName) || empName.toLowerCase().includes(coversName));
                                        const matchesId = coversEmpId && coversEmpId === selectedCell.empId;
                                        const matchesShift = (absShiftId && (absShiftId === shift?.id || absShiftId === absence?.shiftId || absShiftId === absence?.id))
                                            || (causedShiftId && (causedShiftId === shift?.id || causedShiftId === absence?.shiftId));
                                        const matchesComments = comments.includes(`cubriendo a ${empName.toLowerCase()}`)
                                            || comments.includes(`cubre a ${empName.toLowerCase()}`)
                                            || (titularLastName.length > 2 && comments.includes(`cubre ${titularLastName}`))
                                            || (titularLastName.length > 2 && comments.includes(`cubre: ${titularLastName}`));

                                        if (matchesName || matchesId || matchesShift || matchesComments) {
                                            const covEmp = employees.find((e: any) => e.id === s.employeeId);
                                            const covName = covEmp?.name || s.employeeName || '—';
                                            if (String(covName).toUpperCase() === 'VACANTE') continue;
                                            const covCode = String(s.code || '').toUpperCase();
                                            return {
                                                employeeName: covName,
                                                code: covCode,
                                                shift: s,
                                                objectiveName: s.objectiveName || (s.objectiveId ? getObjectiveName(s.objectiveId) : serviceName),
                                            };
                                        }
                                    }

                                    // 4. Si la ausencia está en este objetivo y existe una cobertura operativa en el mismo puesto/objetivo/banda
                                    const targetObj = String(shift?.objectiveId || absence?.objectiveId || selectedObjective || '');
                                    const reasonStr = String(absence?.reason || '');
                                    const reasonPosMatch = reasonStr.match(/\(([^)]+)\)/);
                                    const extractedPos = reasonPosMatch ? reasonPosMatch[1].trim() : '';
                                    const targetPos = String(shift?.positionName || absence?.positionName || extractedPos || coveredPosition || '');

                                    let targetCode = String(shift?.code || absence?.shiftCode || '').toUpperCase();
                                    if (!targetCode && reasonStr) {
                                        if (reasonStr.includes('04:00') || reasonStr.includes('16:00') || reasonStr.includes('Turno T') || reasonStr.includes('turno T')) targetCode = 'T';
                                        else if (reasonStr.includes('06:00') || reasonStr.includes('08:00') || reasonStr.includes('Turno M') || reasonStr.includes('turno M')) targetCode = 'M';
                                        else if (reasonStr.includes('22:00') || reasonStr.includes('12:00') || reasonStr.includes('Turno N') || reasonStr.includes('turno N')) targetCode = 'N';
                                        else if (reasonStr.includes('D12')) targetCode = 'D12';
                                        else if (reasonStr.includes('N12')) targetCode = 'N12';
                                    }

                                    if (targetObj) {
                                        const matchingOpsCovers = candidates.filter(c =>
                                            !isVacancyCandidate(c) &&
                                            isOpsCoverageShift(c) &&
                                            shiftMatchesObjective(c, targetObj)
                                        );

                                        // Prioridad 1: Coincide puesto y código/banda
                                        const exactMatch = matchingOpsCovers.find(c => {
                                            const codeMatch = !targetCode || String(c.code || '').toUpperCase() === targetCode;
                                            const posMatch = !targetPos || targetPos === 'General' || String(c.positionName || '').toLowerCase() === targetPos.toLowerCase();
                                            return codeMatch && posMatch;
                                        });
                                        if (exactMatch) {
                                            const covEmp = employees.find((e: any) => e.id === exactMatch.employeeId);
                                            return {
                                                employeeName: covEmp?.name || exactMatch.employeeName || '—',
                                                code: String(exactMatch.code || targetCode || '').toUpperCase(),
                                                shift: exactMatch,
                                                objectiveName: exactMatch.objectiveName || (exactMatch.objectiveId ? getObjectiveName(exactMatch.objectiveId) : serviceName),
                                            };
                                        }

                                        // Prioridad 2: Coincide puesto
                                        if (targetPos && targetPos !== 'General') {
                                            const posMatches = matchingOpsCovers.filter(c => String(c.positionName || '').toLowerCase() === targetPos.toLowerCase());
                                            if (posMatches.length === 1) {
                                                const single = posMatches[0];
                                                const covEmp = employees.find((e: any) => e.id === single.employeeId);
                                                return {
                                                    employeeName: covEmp?.name || single.employeeName || '—',
                                                    code: String(single.code || targetCode || '').toUpperCase(),
                                                    shift: single,
                                                    objectiveName: single.objectiveName || (single.objectiveId ? getObjectiveName(single.objectiveId) : serviceName),
                                                };
                                            }
                                        }

                                        // Prioridad 3: Coincide código/banda
                                        if (targetCode) {
                                            const codeMatches = matchingOpsCovers.filter(c => String(c.code || '').toUpperCase() === targetCode);
                                            if (codeMatches.length === 1) {
                                                const single = codeMatches[0];
                                                const covEmp = employees.find((e: any) => e.id === single.employeeId);
                                                return {
                                                    employeeName: covEmp?.name || single.employeeName || '—',
                                                    code: String(single.code || targetCode || '').toUpperCase(),
                                                    shift: single,
                                                    objectiveName: single.objectiveName || (single.objectiveId ? getObjectiveName(single.objectiveId) : serviceName),
                                                };
                                            }
                                        }

                                        // Prioridad 4: Cobertura operativa única en el objetivo ese día
                                        if (matchingOpsCovers.length === 1) {
                                            const single = matchingOpsCovers[0];
                                            const covEmp = employees.find((e: any) => e.id === single.employeeId);
                                            return {
                                                employeeName: covEmp?.name || single.employeeName || '—',
                                                code: String(single.code || targetCode || '').toUpperCase(),
                                                shift: single,
                                                objectiveName: single.objectiveName || (single.objectiveId ? getObjectiveName(single.objectiveId) : serviceName),
                                            };
                                        }
                                    }

                                    return null;
                                };
                                const isOpsAbsent = !!(shift?.isAbsent || shift?.status === 'ABSENT');
                                const coverageInfo = (absence || isRRHHCode || isOpsAbsent) ? resolveCoverageForAbsence() : null;
                                const ABSENCE_FRANCO_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA']);
                                const isWorkCode = (c: string) => !!c && !ABSENCE_FRANCO_CODES.has(c.toUpperCase());
                                const resolveOriginalWorkShift = () => {
                                    // 1) Código preservado al aplicar cobertura (banda que se cubrió)
                                    const pendingTitular = pending && !pending.isDeleted ? pending : null;
                                    const storedOrig = String(
                                      pendingTitular?.originalCode || shift?.originalCode || '',
                                    ).toUpperCase();
                                    if (storedOrig && isWorkCode(storedOrig)) {
                                        const posName = pendingTitular?.originalPositionName || shift?.originalPositionName || coveredPosition;
                                        const h = SHIFT_HOURS_LOOKUP[storedOrig] || 8;
                                        return {
                                            code: storedOrig,
                                            label: LEGEND_DESCRIPTIONS[storedOrig] || storedOrig,
                                            schedule: VACANCY_BAND_SCHEDULE[storedOrig]
                                              || formatShiftScheduleLabel(
                                                { code: storedOrig, positionName: posName },
                                                storedOrig,
                                              ),
                                            hours: h,
                                            service: serviceName,
                                            position: posName,
                                        };
                                    }
                                    if (coverageInfo?.shift && coverageInfo.code && NON_ABSENCE_CODES.has(coverageInfo.code)) {
                                        const h = Number(coverageInfo.shift.hours) || SHIFT_HOURS_LOOKUP[coverageInfo.code] || 8;
                                        return {
                                            code: coverageInfo.code,
                                            label: LEGEND_DESCRIPTIONS[coverageInfo.code] || coverageInfo.code,
                                            schedule: formatShiftScheduleLabel(coverageInfo.shift, coverageInfo.code),
                                            hours: h,
                                            service: coverageInfo.objectiveName || serviceName,
                                            position: coverageInfo.shift.positionName || coveredPosition,
                                        };
                                    }
                                    if (pendingTitular?.coveredBy && code && NON_ABSENCE_CODES.has(code)) {
                                        const h = Number(pendingTitular.hours) || SHIFT_HOURS_LOOKUP[code] || 8;
                                        return {
                                            code,
                                            label: LEGEND_DESCRIPTIONS[code] || code,
                                            schedule: formatShiftScheduleLabel(pendingTitular, code),
                                            hours: h,
                                            service: serviceName,
                                            position: coveredPosition,
                                        };
                                    }
                                    // Fallback: el turno planificado del empleado ese día (ya disponible en `shift`)
                                    const shiftCode = String(shift?.code || '').toUpperCase();
                                    if (shift && isWorkCode(shiftCode)) {
                                        const h = Number(shift.hours) || SHIFT_HOURS_LOOKUP[shiftCode] || 8;
                                        return {
                                            code: shiftCode,
                                            label: LEGEND_DESCRIPTIONS[shiftCode] || shiftCode,
                                            schedule: formatShiftScheduleLabel(shift, shiftCode),
                                            hours: h,
                                            service: serviceName,
                                            position: shift.positionName || coveredPosition,
                                        };
                                    }
                                    // Fallback: buscar desde los datos de la ausencia (shiftCode o parsing de motivo)
                                    const absShiftCode = String(absence?.shiftCode || '').toUpperCase();
                                    let inferredCode = isWorkCode(absShiftCode) ? absShiftCode : '';
                                    let scheduleText = '';
                                    if (!inferredCode && absence?.reason) {
                                        const r = String(absence.reason);
                                        const matchSchedule = r.match(/(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:[ap]\.?\s*m\.?)?)/i);
                                        if (matchSchedule) {
                                            scheduleText = `${matchSchedule[1]} - ${matchSchedule[2]}`;
                                        }
                                        if (r.includes('04:00') || r.includes('16:00') || r.includes('Turno T') || r.includes('turno T')) inferredCode = 'T';
                                        else if (r.includes('06:00') || r.includes('08:00') || r.includes('Turno M') || r.includes('turno M')) inferredCode = 'M';
                                        else if (r.includes('22:00') || r.includes('12:00') || r.includes('Turno N') || r.includes('turno N')) inferredCode = 'N';
                                        else if (r.includes('D12')) inferredCode = 'D12';
                                        else if (r.includes('N12')) inferredCode = 'N12';
                                    }
                                    if (inferredCode) {
                                        const posName = absence?.positionName || coveredPosition;
                                        const h = SHIFT_HOURS_LOOKUP[inferredCode] || 8;
                                        return {
                                            code: inferredCode,
                                            label: LEGEND_DESCRIPTIONS[inferredCode] || `Turno ${inferredCode}`,
                                            schedule: scheduleText || VACANCY_BAND_SCHEDULE[inferredCode] || formatShiftScheduleLabel({ code: inferredCode, positionName: posName }, inferredCode),
                                            hours: h,
                                            service: absence?.objectiveName || serviceName,
                                            position: posName,
                                        };
                                    }
                                    return null;
                                };
                                const originalWorkShift = (absence || isRRHHCode || isOpsAbsent) ? resolveOriginalWorkShift() : null;
                                const absenceTypeLabel = absence?.type || shift?.name || LEGEND_DESCRIPTIONS[code] || code || '—';
                                const ABSENCE_STATUS_ES: Record<string, string> = {
                                    APPROVED: 'Aprobada', PENDING: 'Pendiente', REJECTED: 'Rechazada',
                                    ACTIVE: 'Activa', CLOSED: 'Cerrada', REGISTERED: 'Registrada',
                                    VERIFIED: 'Verificada', JUSTIFIED: 'Justificada',
                                };
                                // Ausencias injustificadas/sin aviso: el estado APPROVED significa "registrada por RRHH",
                                // no que la ausencia fue aprobada — se muestra "Registrada" para no confundir.
                                const UNEXCUSED_CODES = new Set(['AA']);
                                const absenceRawStatus = absence?.status || (isRRHHCode ? 'APPROVED' : '');
                                const isUnexcused = UNEXCUSED_CODES.has(code) || absence?.type?.toLowerCase().includes('injustificada');
                                const absenceStatusLabel = (isUnexcused && absenceRawStatus?.toUpperCase() === 'APPROVED')
                                    ? 'Registrada'
                                    : (ABSENCE_STATUS_ES[absenceRawStatus?.toUpperCase?.()] || absenceRawStatus || '');
                                const coveringEmployee = coverageInfo
                                    ? (coverageInfo.code ? `${coverageInfo.employeeName} (${coverageInfo.code})` : coverageInfo.employeeName)
                                    : (shift?.coveredBy || shift?.coveredByEmployeeName || pending?.coveredBy || pending?.coveredByEmployeeName || null);
                                const hasSwap = !!(shift?.swapWith || shift?.swapDate);
                                const isSwapPersisted = hasSwap && !pending && !!shift?.id;
                                const coversAbsenceName = String(
                                    shift?.coversAbsenceEmployeeName || shift?.absenceEmployeeName || shift?.coveredEmployeeName || '',
                                ).trim();

                                const resolveWhoThisShiftCovers = (): string | null => {
                                    if (coversAbsenceName) return coversAbsenceName;
                                    const dateStr = selectedCell.dateStr;
                                    const covererLast = employeeName.split(',')[0]?.trim().toLowerCase() || '';
                                    const sources: any[] = [];
                                    if (cellTurnosMap) {
                                        for (const [k, arr] of Object.entries(cellTurnosMap)) {
                                            if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${selectedCell.empId}_`)) continue;
                                            if (Array.isArray(arr)) sources.push(...arr);
                                        }
                                    }
                                    for (const [k, raw] of Object.entries({ ...shiftsMap, ...pendingChanges })) {
                                        if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${selectedCell.empId}_`)) continue;
                                        sources.push(raw as any);
                                    }
                                    for (const t of sources) {
                                        if (!t || t.isDeleted) continue;
                                        if (t.employeeId === 'VACANTE' || t.isUnassigned) continue;
                                        const byId = String(t.coveredByEmployeeId || t.coveredBy || '');
                                        const byName = String(t.coveredByEmployeeName || t.coveredBy || '').toLowerCase();
                                        if (byId && byId === selectedCell.empId) {
                                            return t.employeeName || employees.find((e: any) => e.id === t.employeeId)?.name || null;
                                        }
                                        if (covererLast.length > 2 && byName.includes(covererLast)) {
                                            return t.employeeName || employees.find((e: any) => e.id === t.employeeId)?.name || null;
                                        }
                                    }
                                    const note = String(shift?.coverageNote || shift?.comments || '');
                                    const m = note.match(/cubre(?:ndo)?\s+a[:\s]+([^|.\n]+)/i);
                                    if (m) return m[1].trim();
                                    return null;
                                };

                                const inferredCoversName = resolveWhoThisShiftCovers();
                                const isCoverageSegmentCell = !!(
                                    shift?.isEarlyStart
                                    || shift?.isExtended
                                    || shift?.isRetention
                                    || shift?.coverageSegmentRole
                                    || shift?.coveragePackageId
                                    || isOpsCoverageShift(shift)
                                );
                                const showRrhhPanel = !!(absence || isRRHHCode);
                                const isCovererCell = !!(inferredCoversName || (isCoverageSegmentCell && !isOpsAbsent && !showRrhhPanel));
                                const showTraceNarrative = !!(showRrhhPanel || isOpsAbsent || isCovererCell || isCoverageSegmentCell);
                                const isReadOnly = isConsolidated || isSwapPersisted;

                                const findLinkedVacancyOpen = (): boolean => {
                                    const dateStr = selectedCell.dateStr;
                                    const titularShiftId = String(shift?.id || '');
                                    const sources: any[] = [];
                                    if (cellTurnosMap) {
                                        for (const [k, arr] of Object.entries(cellTurnosMap)) {
                                            if (!k.endsWith(`_${dateStr}`)) continue;
                                            if (Array.isArray(arr)) sources.push(...arr);
                                        }
                                    }
                                    for (const [k, raw] of Object.entries({ ...shiftsMap, ...pendingChanges })) {
                                        if (!k.endsWith(`_${dateStr}`)) continue;
                                        sources.push(raw);
                                    }
                                    return sources.some((c: any) => {
                                        if (!c || c.isDeleted) return false;
                                        const origin = String(c.origin || '').toUpperCase();
                                        const isVac =
                                            c.employeeId === 'VACANTE'
                                            || c.isUnassigned === true
                                            || origin.startsWith('VACANTE_')
                                            || String(c.employeeName || '').toUpperCase() === 'VACANTE';
                                        if (!isVac) return false;
                                        const caused = String(c.causedByShiftId || c.absenceShiftId || c.coverageSourceId || '');
                                        if (titularShiftId && caused === titularShiftId) return true;
                                        const absEmp = String(c.coversAbsenceEmployeeName || c.absenceEmployeeName || c.causedByEmployeeId || '');
                                        if (selectedCell.empId && String(c.causedByEmployeeId || '') === selectedCell.empId) return true;
                                        const titularLast = employeeName.split(',')[0]?.trim().toLowerCase() || '';
                                        if (titularLast.length > 2 && absEmp.toLowerCase().includes(titularLast)) return true;
                                        return false;
                                    });
                                };

                                const vacancyStillOpen = (absence || isOpsAbsent) ? findLinkedVacancyOpen() : false;

                                const coverHowLabel = (() => {
                                    const covShift = coverageInfo?.shift || (isCoverageSegmentCell ? shift : null);
                                    if (!covShift && !isCoverageSegmentCell) return shift?.coverageType ? String(shift.coverageType) : null;
                                    const src = covShift || shift;
                                    if (src.isFrancoTrabajado || String(src.code || '').toUpperCase() === 'FT') return 'Franco trabajado (FT)';
                                    if (src.isExtended || src.coverageRole === 'EXTENSION' || src.coverageSegmentRole === 'EXTENSION') return 'Extensión de jornada';
                                    if (src.isEarlyStart || src.coverageRole === 'EARLY_START' || src.coverageSegmentRole === 'EARLY_START') return 'Adelanto (cobertura)';
                                    const ct = String(src.coverageType || '').toUpperCase();
                                    if (ct === 'CROSS_POSITION' || ct === 'OTRO_PUESTO') return 'Otro puesto (mismo objetivo)';
                                    if (ct === 'CROSS_OBJECTIVE' || ct === 'TRASLADO' || ct === 'CROSS_OBJ') return 'Traslado (otro objetivo ≤10 km)';
                                    const o = String(src.origin || '').toUpperCase();
                                    if (o === 'RETEN' || src.isRetention) return 'Retención (RET)';
                                    if (o === 'OPERATIONS_COVERAGE') return 'Cobertura Ops';
                                    if (src.resolvedBy === 'OPERACIONES') return 'Resuelto en Ops';
                                    return o ? o.replace(/_/g, ' ') : (shift?.coverageType ? String(shift.coverageType) : null);
                                })();

                                const traceRole: 'titular' | 'coverer' | 'normal' = (isCovererCell || isCoverageSegmentCell) && !isOpsAbsent && !showRrhhPanel
                                    ? 'coverer'
                                    : (showRrhhPanel || isOpsAbsent ? 'titular' : 'normal');

                                const planningTraceSteps = showTraceNarrative
                                    ? buildPlanningCellTrace({
                                        role: traceRole,
                                        titularName: employeeName,
                                        dateStr: selectedCell.dateStr,
                                        plannedCode: originalWorkShift?.code || (NON_ABSENCE_CODES.has(code) ? code : null) || coverageInfo?.code || null,
                                        plannedSchedule: originalWorkShift?.schedule
                                            || (shift ? formatShiftScheduleLabel(shift, code) : null),
                                        plannedPosition: originalWorkShift?.position || coveredPosition,
                                        plannedService: originalWorkShift?.service || serviceName,
                                        absenceType: absence?.type || (isRRHHCode ? (LEGEND_DESCRIPTIONS[code] || code) : null) || (isOpsAbsent ? 'Ausencia operativa' : null),
                                        absenceReason: absence?.reason || shift?.comments || null,
                                        isOpsAbsent,
                                        isPresent: (() => {
                                            const cu = String(shift?.code || code || '').toUpperCase();
                                            const passive = cu === 'RET' || shift?.isReten === true;
                                            if (passive) return false;
                                            return !!(shift?.isPresent || shift?.status === 'PRESENT' || shift?.status === 'COMPLETED');
                                        })(),
                                        operacionallyCovered: !!(shift?.operacionallyCovered || coveringEmployee),
                                        coveredByName: coverageInfo?.employeeName || (coveringEmployee ? String(coveringEmployee).replace(/\s*\([^)]*\)\s*$/, '').trim() : null),
                                        coveredByCode: coverageInfo?.code || null,
                                        coveredByHow: coverHowLabel,
                                        vacancyOpen: vacancyStillOpen,
                                        covererName: employeeName,
                                        coversAbsenceName: inferredCoversName || coversAbsenceName || null,
                                        covererCode: code || null,
                                        covererOrigin: coverHowLabel || shift?.origin || shift?.coverageType || null,
                                    })
                                    : [];

                                const TraceChainPanel = planningTraceSteps.length > 0 ? (
                                    <div className="rounded-xl border-2 border-indigo-200 bg-white overflow-hidden shadow-sm">
                                        <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-black uppercase tracking-wide text-indigo-900">Cadena · qué pasó</span>
                                            <span className="text-[9px] font-bold text-indigo-600/80 uppercase">Trazabilidad</span>
                                        </div>
                                        <ol className="p-3 space-y-2">
                                            {planningTraceSteps.map((step, i) => (
                                                <li key={step.key} className={`rounded-lg border px-3 py-2 ${PLANNING_TRACE_TONE[step.tone]}`}>
                                                    <p className="text-[10px] font-black uppercase tracking-wide opacity-80">{step.title}</p>
                                                    <p className="text-xs font-semibold mt-0.5 leading-snug">{step.detail}</p>
                                                    {i < planningTraceSteps.length - 1 && (
                                                        <p className="text-[9px] font-black text-slate-400 mt-1">↓</p>
                                                    )}
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                ) : null;

                                const displayClock = resolveShiftDisplayClockParts(shift, code);
                                const plannedStart = displayClock.start;
                                const plannedEnd = displayClock.end;
                                const rawRealStart = shift?.realStartTime ? formatTime(shift.realStartTime) : (shift?.checkInTime ? formatTime(shift.checkInTime) : '--:--');
                                const rawRealEnd = shift?.realEndTime ? formatTime(shift.realEndTime) : (shift?.checkOutTime ? formatTime(shift.checkOutTime) : '--:--');
                                const isPlaceholderClock = (t: string) => {
                                    const raw = String(t || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\./g, '');
                                    return /^(0?0:00|12:00\s*a\s*m|--:--)$/.test(raw);
                                };
                                const realStart = (displayClock.usedBandFallback && isPlaceholderClock(rawRealStart)) ? '--:--' : rawRealStart;
                                const realEnd = (displayClock.usedBandFallback && isPlaceholderClock(rawRealEnd)) ? '--:--' : rawRealEnd;
                                const rawStatus = (shift?.status || '').toString().toUpperCase();
                                const STATUS_LABELS: Record<string, string> = { PRESENT: 'Presente', COMPLETED: 'Completado', ABSENT: 'Ausente', LATE: 'Tarde', INTERRUPTED: 'Interrumpido', PENDING: 'Pendiente' };
                                const status = STATUS_LABELS[rawStatus] || rawStatus || '-';
                                const storedHours = Number(shift?.hours);
                                let calcHoursFromTs = 0;
                                if (shift?.startTime && shift?.endTime && typeof shift.startTime !== 'string') {
                                    const startMs = shift.startTime.toDate ? shift.startTime.toDate().getTime() : new Date(shift.startTime.seconds * 1000).getTime();
                                    const endMs = shift.endTime.toDate ? shift.endTime.toDate().getTime() : new Date(shift.endTime.seconds * 1000).getTime();
                                    let durH = (endMs - startMs) / 3600000;
                                    if (Math.abs(durH) < 1 / 60) durH = 0;
                                    else if (durH < 0) durH += 24;
                                    calcHoursFromTs = Math.max(0, durH);
                                }
                                // Si timestamps dan 24h pero el código es banda CCT corta, preferir lookup (caso 00:00→00:00 wrap).
                                const bandLookup = code ? (SHIFT_HOURS_LOOKUP[code] || 0) : 0;
                                const hours = (storedHours > 0 && storedHours <= 16)
                                    ? storedHours
                                    : (calcHoursFromTs >= 0.5 && calcHoursFromTs <= 16)
                                        ? calcHoursFromTs
                                        : (bandLookup || storedHours || calcHoursFromTs || 0);
                                const showRealTimes = isConsolidated;

                                if (isReadOnly || showTraceNarrative) {
                                    return (
                                        <>
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="min-w-0">
                                                    <h3 className="font-black text-lg text-slate-800 truncate">{employeeName}</h3>
                                                    <p className="text-xs text-slate-500 font-bold uppercase">{selectedCell.dateStr}</p>
                                                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                        {isConsolidated && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                                Consolidado
                                                            </span>
                                                        )}
                                                        {isPastClosed && !isConsolidated && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                                                                Cerrado
                                                            </span>
                                                        )}
                                                        {isSwapPersisted && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-cyan-50 text-cyan-800 border-cyan-200">
                                                                Intercambio
                                                            </span>
                                                        )}
                                                        {(absence || isRRHHCode) && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                                                                RRHH
                                                            </span>
                                                        )}
                                                        {isOpsAbsent && !absence && !isRRHHCode && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-200">
                                                                Ausente Ops
                                                            </span>
                                                        )}
                                                        {isCovererCell && !isOpsAbsent && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-indigo-50 text-indigo-800 border-indigo-200">
                                                                Cubre a otro
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button onClick={() => setSelectedCell(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
                                            </div>

                                            <div className="space-y-3">
                                                {TraceChainPanel}

                                                {(absence || isRRHHCode) ? (
                                                    <div className="rounded-xl border-2 border-amber-200 bg-white overflow-hidden shadow-sm">
                                                        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-black uppercase tracking-wide text-amber-900">Novedad RRHH</span>
                                                            {absenceStatusLabel && (
                                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border shrink-0 ${absenceStatusBadgeClass(absenceStatusLabel)}`}>
                                                                    {absenceStatusLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="p-4 space-y-4">
                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">1 · Turno que tenía</p>
                                                                {originalWorkShift ? (
                                                                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span className="font-mono font-black text-sm text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{originalWorkShift.code}</span>
                                                                            <span className="text-sm font-bold text-slate-800">{originalWorkShift.label}</span>
                                                                            {originalWorkShift.hours > 0 && (
                                                                                <span className="text-xs font-mono text-slate-500">{originalWorkShift.hours}h</span>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-xs font-mono text-slate-600 mt-1.5">{originalWorkShift.schedule}</p>
                                                                        <p className="text-xs text-slate-500 mt-1">
                                                                            {originalWorkShift.service}
                                                                            {originalWorkShift.position && originalWorkShift.position !== 'General' && (
                                                                                <span className="text-slate-400"> · {originalWorkShift.position}</span>
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm text-slate-400 italic">Sin turno de trabajo asignado ese día</p>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">2 · Estado</p>
                                                                <span className={`inline-flex text-xs font-black px-3 py-1.5 rounded-lg border ${absenceStatusBadgeClass(absenceStatusLabel)}`}>
                                                                    {absenceStatusLabel || '—'}
                                                                </span>
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">3 · Tipo de novedad</p>
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-sm font-black text-slate-800">{absenceTypeLabel}</span>
                                                                    {code && (
                                                                        <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">{code}</span>
                                                                    )}
                                                                </div>
                                                                {absence?.reason && (
                                                                    <p className="text-xs text-amber-800/80 mt-1.5 font-medium">{absence.reason}</p>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">4 · Cubierto por</p>
                                                                {coverageInfo?.employeeName ? (
                                                                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                                                                        <p className="text-sm font-black text-emerald-900">{coverageInfo.employeeName}</p>
                                                                        {coverageInfo.code && (
                                                                            <p className="text-xs text-emerald-700 mt-0.5">
                                                                                Turno asignado: <span className="font-mono font-bold">{coverageInfo.code}</span>
                                                                                {coverageInfo.shift && (
                                                                                    <span className="text-emerald-600/80"> · {formatShiftScheduleLabel(coverageInfo.shift, coverageInfo.code)}</span>
                                                                                )}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm text-amber-700 font-bold">Sin cobertura asignada</p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {pending ? (
                                                            <div className="px-4 pb-4">
                                                                <button onClick={handleDelete} className="w-full py-2 rounded-xl bg-white border border-amber-200 text-amber-900 font-black text-xs hover:bg-amber-100">
                                                                    Quitar marca (borrador)
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            coverageInfo?.employeeName ? (
                                                                <p className="px-4 pb-3 text-[10px] font-bold text-emerald-700 text-center">
                                                                    Licencia cubierta — en reportes/liquidación figura como novedad RRHH; las horas del puesto las computa {coverageInfo.employeeName}.
                                                                </p>
                                                            ) : (
                                                                <p className="px-4 pb-3 text-[10px] font-bold text-amber-800/80 text-center">
                                                                    Novedad RRHH — podés re-procesar cobertura abajo si el día no está consolidado.
                                                                </p>
                                                            )
                                                        )}
                                                        {isRRHHCode && !isConsolidated && !pending && absence && (
                                                            <div className="px-4 pb-4">
                                                                <button
                                                                    onClick={() => {
                                                                        const vd = { ...absence, source: 'AUSENCIA', employeeId: selectedCell.empId, employeeName, focusDate: selectedCell.dateStr };
                                                                        setSelectedCell(null);
                                                                        setVacancyData(vd);
                                                                        setShowVacancyModal(true);
                                                                    }}
                                                                    className="w-full py-2.5 rounded-xl bg-amber-600 text-white font-black text-xs hover:bg-amber-700"
                                                                >
                                                                    Re-procesar cobertura
                                                                </button>
                                                            </div>
                                                        )}
                                                        {isRRHHCode && !isConsolidated && !pending && !absence && (
                                                            <div className="px-4 pb-4">
                                                                <button
                                                                    onClick={() => {
                                                                        const newChanges = { ...pendingChanges };
                                                                        newChanges[`${selectedCell.empId}_${selectedCell.dateStr}`] = { isDeleted: true };
                                                                        setPendingChanges(newChanges);
                                                                        setSelectedCell(null);
                                                                        toast.info('Turno marcado para borrar — guardá los cambios.');
                                                                    }}
                                                                    className="w-full py-2.5 rounded-xl bg-slate-600 text-white font-black text-xs hover:bg-slate-700"
                                                                >
                                                                    Borrar turno asignado por error
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                <div className="p-3 rounded-xl border bg-slate-50">
                                                    <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Planificado (Planificador)</div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div className="font-bold text-slate-600">Turno</div>
                                                        <div className="text-slate-800 font-bold">
                                                            <span className="font-mono">{code || '-'}</span>
                                                            <span className="mx-2 text-slate-300">|</span>
                                                            <span>{coveredPosition}</span>
                                                        </div>
                                                        <div className="font-bold text-slate-600">Servicio</div>
                                                        <div className="text-slate-800">{serviceName || '-'}</div>
                                                        <div className="font-bold text-slate-600">Horario</div>
                                                        <div className="font-mono text-slate-800">
                                                            {plannedStart} - {plannedEnd}
                                                            {displayClock.usedBandFallback && (
                                                                <span className="block text-[9px] font-bold text-amber-700 mt-0.5 normal-case">
                                                                    Banda CCT (timestamps 00:00=00:00 inválidos — no es 24h)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="font-bold text-slate-600">Horas</div>
                                                        <div className="font-mono text-slate-800">{hours ? `${hours}h` : '-'}</div>
                                                    </div>
                                                </div>

                                                <div className="p-3 rounded-xl border bg-white">
                                                    <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Real / Estado</div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div className="font-bold text-slate-600">Estado</div>
                                                        <div className="font-mono text-slate-800">{status || '-'}</div>
                                                        <div className="font-bold text-slate-600">Ingreso</div>
                                                        <div className="font-mono text-slate-800">{showRealTimes ? realStart : '--:--'}</div>
                                                        <div className="font-bold text-slate-600">Egreso</div>
                                                        <div className="font-mono text-slate-800">{showRealTimes ? realEnd : '--:--'}</div>
                                                    </div>
                                                </div>
                                                    </>
                                                )}

                                                {isConsolidated && (absence || isRRHHCode) && (
                                                    <div className="p-3 rounded-xl border bg-white">
                                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Fichada real</div>
                                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                                            <div className="font-bold text-slate-600">Estado ops.</div>
                                                            <div className="font-mono text-slate-800">{status || '-'}</div>
                                                            <div className="font-bold text-slate-600">Ingreso</div>
                                                            <div className="font-mono text-slate-800">{realStart}</div>
                                                            <div className="font-bold text-slate-600">Egreso</div>
                                                            <div className="font-mono text-slate-800">{realEnd}</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {hasSwap && (
                                                    <div className="p-3 rounded-xl border bg-cyan-50 border-cyan-200">
                                                        <div className="text-[10px] font-black uppercase text-cyan-800 mb-2">Intercambio / Enroque</div>
                                                        <div className="text-xs text-cyan-900 font-bold">
                                                            {shift?.swapWith ? <>Con: <span className="font-black">{shift.swapWith}</span></> : '—'}
                                                            {shift?.swapDate ? <span className="ml-2 font-mono">({shift.swapDate})</span> : null}
                                                        </div>
                                                        <div className="text-[10px] text-cyan-800 mt-1">
                                                            {shift?.isFrancoCompensatorio ? 'FxF (Franco Compensatorio / FF)' : (shift?.isSwap ? 'Swap' : '')}
                                                        </div>
                                                    </div>
                                                )}

                                                <button onClick={() => setSelectedCell(null)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800">
                                                    Cerrar
                                                </button>
                                            </div>
                                        </>
                                    );
                                }

                                // Horas de descanso del franco (disponible en todos los branches del modal)
                                const modalFrancoCode = String(shift?.code || pending?.code || '').toUpperCase();
                                const modalIsFranco = ['F','FF','FP','FT'].includes(modalFrancoCode) || !!shift?.isFranco || !!pending?.isFranco;
                                const francoRestHModal = modalIsFranco ? (() => {
                                    try {
                                        const [yr, mo, dy] = selectedCell.dateStr.split('-').map(Number);
                                        const di = daysInMonth.findIndex((d: Date) =>
                                            d.getFullYear() === yr && d.getMonth() + 1 === mo && d.getDate() === dy
                                        );
                                        return di >= 0 ? calcFrancoRestHours(selectedCell.empId, di) : null;
                                    } catch { return null; }
                                })() : null;

                                // Vista previa: celda con turno asignado, sin cambios pendientes y sin modo edición activo
                                const hasPendingForCell = !!pending && !pending.isDeleted;
                                const previewPublishKey = planificacionPublishLookupKey(
                                    selectedObjective,
                                    currentDate.getFullYear(),
                                    currentDate.getMonth() + 1,
                                );
                                const previewIsPublished = isPlanificacionPublished(publishStatusMap[previewPublishKey]);
                                // Puede editar si: no está publicado, o está en modo corrección (superadmin)
                                const canEdit = !previewIsPublished || correctionMode;

                                if (shift && !cellEditMode && !hasPendingForCell) {
                                    const shiftStyle = SHIFT_STYLES[code] || 'bg-slate-100 text-slate-700 border-slate-200';
                                    const isFrancoShift = shift.code === 'F' || shift.isFranco;
                                    const isFrancoLike = isFrancoShift || ['F','FF','FP','FT'].includes(code);
                                    const francoRestH = francoRestHModal;
                                    const hasDraft = shift.draft === true;
                                    const isCrossObjectiveShift = shift.objectiveId && String(shift.objectiveId) !== String(selectedObjective);
                                    return (
                                        <>
                                            <div className="flex justify-between items-start mb-5">
                                                <div>
                                                    <h3 className="font-black text-lg text-slate-800">{employeeName}</h3>
                                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{selectedCell.dateStr}</p>
                                                </div>
                                                <button onClick={() => setSelectedCell(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
                                            </div>

                                            {/* Badge principal del turno */}
                                            <div className={`flex items-center gap-3 p-4 rounded-xl border mb-4 ${shiftStyle}`}>
                                                <span className="text-3xl font-black">{code || '—'}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-black text-base leading-tight">{shift.type || shift.name || (isFrancoShift ? 'Franco' : code)}</p>
                                                    {!isFrancoShift && (() => {
                                                        const _mb2 = resolveCellSecondBlock(
                                                            key,
                                                            pendingChanges,
                                                            secondBlockMap,
                                                            shift.positionName,
                                                            code,
                                                            positionStructure,
                                                        );
                                                        const _mb2s = _mb2?.startTime ? formatTime(_mb2.startTime) : null;
                                                        const _mb2e = _mb2?.endTime ? formatTime(_mb2.endTime) : null;
                                                        return <p className="text-xs font-bold opacity-70">{plannedStart} – {plannedEnd}{_mb2s && _mb2e ? ` + ${_mb2s} – ${_mb2e}` : ''} · {hours > 0 ? `${hours}h` : ''}</p>;
                                                    })()}
                                                    {isFrancoShift && <p className="text-xs font-bold opacity-70">Día libre</p>}
                                                </div>
                                                {hasDraft && (
                                                    <span className="text-[9px] font-black uppercase bg-white/60 border border-current px-2 py-0.5 rounded-lg opacity-80">Borrador</span>
                                                )}
                                                {previewIsPublished && !hasDraft && (
                                                    <span className="text-[9px] font-black uppercase bg-white/60 border border-current px-2 py-0.5 rounded-lg opacity-80 flex items-center gap-1"><CheckCircle size={9}/> Publicado</span>
                                                )}
                                            </div>

                                            {/* TURA — turno agregado por cliente */}
                                            {turaMap[shift.id] && (() => {
                                                const tura = turaMap[shift.id];
                                                const tStart = tura.startTime ? formatTime(tura.startTime) : '--:--';
                                                const tEnd   = tura.endTime   ? formatTime(tura.endTime)   : '--:--';
                                                const tHours = Number(tura.hours) > 0 ? Number(tura.hours) : (SHIFT_HOURS_LOOKUP['TURA'] ?? 8);
                                                const tHoursLabel = Number.isInteger(tHours) ? `${tHours}` : tHours.toFixed(1);
                                                return (
                                                    <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50 mb-4">
                                                        <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">TURA</span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-black text-red-700 leading-tight">Turno Agregado — pedido del cliente</p>
                                                            <p className="text-[11px] text-red-500 font-bold">{tStart} – {tEnd} · {tHoursLabel}h</p>
                                                            {tura.autorizadoPorNombre && (
                                                                <p className="text-[10px] text-red-400 font-bold mt-0.5">Autorizó: {tura.autorizadoPorNombre}</p>
                                                            )}
                                                            {tura.solicitadoPorNombre && (
                                                                <p className="text-[10px] text-red-400 font-bold">Solicitó: {tura.solicitadoPorNombre}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* RFZ — refuerzo de cliente asignado a este guardia */}
                                            {code === 'RFZ' && (
                                                <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50 mb-4">
                                                    <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">RFZ</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-black text-red-700 leading-tight">Refuerzo solicitado por cliente</p>
                                                        <p className="text-[11px] text-red-500 font-bold">{plannedStart} – {plannedEnd} · {hours > 0 ? `${hours}h` : ''}</p>
                                                        {shift?.autorizadoPorNombre && (
                                                            <p className="text-[10px] text-red-400 font-bold mt-0.5">Autorizó: {shift.autorizadoPorNombre}</p>
                                                        )}
                                                        {shift?.solicitadoPorNombre && (
                                                            <p className="text-[10px] text-red-400 font-bold">Solicitó: {shift.solicitadoPorNombre}</p>
                                                        )}
                                                        {shift?.isFrancoTrabajado && (
                                                            <p className="text-[10px] text-amber-600 font-black mt-0.5">Franco Trabajado (FT)</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Info adicional */}
                                            <div className="space-y-2 mb-5">
                                                {selectedGrupo && grupoUnifiedMode && objectiveId && (() => {
                                                    const _oi = selectedGrupo.objectiveIds.indexOf(objectiveId);
                                                    const _clr = GRUPO_COLOR_HEX[_oi % GRUPO_COLOR_HEX.length] || '#64748b';
                                                    const _nm = _oi >= 0 ? selectedGrupo.objectiveNames[_oi] : (serviceName || objectiveId);
                                                    return (
                                                        <div className="flex items-center gap-2 text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: _clr + '18', color: _clr }}>
                                                            <MapPin size={12} className="shrink-0"/>
                                                            <span>{_nm}</span>
                                                        </div>
                                                    );
                                                })()}
                                                {coveredPosition && coveredPosition !== 'General' && (
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <Briefcase size={13}/> <span className="font-bold">{coveredPosition}</span>
                                                    </div>
                                                )}
                                                {coveringEmployee && (
                                                    <div className="flex items-center gap-2 text-xs text-indigo-600">
                                                        <UserCheck size={13}/> Cubierto por <span className="font-bold">{coveringEmployee}</span>
                                                    </div>
                                                )}
                                                {shift.isFrancoTrabajado && (
                                                    <div className="flex items-center gap-2 text-xs text-amber-600">
                                                        <AlertTriangle size={13}/> <span className="font-bold">Franco Trabajado (FT)</span>
                                                    </div>
                                                )}
                                                {shift.isFrancoCompensatorio && (
                                                    <div className="flex items-center gap-2 text-xs text-cyan-600">
                                                        <ArrowLeftRight size={13}/> <span className="font-bold">Franco Compensatorio (FF)</span>
                                                    </div>
                                                )}
                                                {francoRestH != null && (
                                                    <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                                        <Clock size={12}/>
                                                        <span>Descanso total: <span className="font-black text-emerald-700">{francoRestH}h</span></span>
                                                    </div>
                                                )}
                                                {hasSwap && (
                                                    <div className="flex items-center gap-2 text-xs text-cyan-600">
                                                        <ArrowLeftRight size={13}/> Swap {shift.swapWith ? `con ${shift.swapWith}` : ''} {shift.swapDate ? `(${shift.swapDate})` : ''}
                                                    </div>
                                                )}
                                                {previewIsPublished && !canEdit && (
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                                        <LockKeyhole size={12}/> Cronograma publicado, usar modo corregir para realizar cambios.
                                                    </div>
                                                )}
                                            </div>

                                            {correctionMode && previewIsPublished && renderDayCoverageClosures(selectedCell.dateStr)}

                                            {/* Acciones */}
                                            {isCrossObjectiveShift && isFrancoShift && canAssignFT && (
                                                <button
                                                    onClick={() => { setFrancoMode('FT_SELECTION'); setCellEditMode(true); }}
                                                    disabled={isServiceLocked}
                                                    className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                >
                                                    <ArrowRightCircle size={14}/> Traer como Franco Trabajado (FT)
                                                </button>
                                            )}
                                            {canEdit && !previewIsPublished && !(isCrossObjectiveShift && isFrancoShift) && (
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setCellEditMode(true)}
                                                            disabled={isServiceLocked}
                                                            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <Edit3 size={14}/> Cambiar
                                                        </button>
                                                        <button
                                                            onClick={handleDelete}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-500 px-4 py-2.5 rounded-xl text-sm font-black transition-colors border border-rose-200"
                                                        >
                                                            <Trash2 size={14}/>
                                                        </button>
                                                    </div>
                                                    {isFrancoShift && canAssignFT && (
                                                        <button
                                                            onClick={() => { setFrancoMode('FT_SELECTION'); setCellEditMode(true); }}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <ArrowRightCircle size={14}/> Asignar FT (Franco Trabajado)
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {/* Publicado: acciones contextuales según tipo de turno */}
                                            {previewIsPublished && !correctionMode && (
                                                <div className="flex flex-col gap-2">
                                                    {isFrancoShift ? (
                                                        canAssignFT ? (
                                                        <button
                                                            onClick={() => { setFrancoMode('FT_SELECTION'); setCellEditMode(true); }}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <ArrowRightCircle size={14}/> Asignar FT (Franco Trabajado)
                                                        </button>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                                                <LockKeyhole size={12}/> Sin permiso para asignar FT (pedí Franco FT en el rol).
                                                            </div>
                                                        )
                                                    ) : (
                                                        <button
                                                            onClick={() => { if (!confirm(`¿Dar Franco Compensatorio a ${employeeName} el ${selectedCell.dateStr}?`)) return; applyToPending({ code: 'FF', name: 'Franco Compensatorio', isFrancoCompensatorio: true, isFranco: true, hours: 0, startTime: '00:00', positionName: coveredPosition }); }}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <ArrowLeftRight size={14}/> Dar FF (Franco Compensatorio)
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {/* Publicado + modo corrección superadmin */}
                                            {previewIsPublished && correctionMode && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setCellEditMode(true)}
                                                        disabled={isServiceLocked}
                                                        className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                    >
                                                        <ShieldAlert size={14}/> Corregir
                                                    </button>
                                                    <button
                                                        onClick={handleDelete}
                                                        disabled={isServiceLocked}
                                                        className="flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-500 px-4 py-2.5 rounded-xl text-sm font-black transition-colors border border-rose-200"
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    );
                                }

                                return (
                                    <>
                                        <div className="flex justify-between items-center mb-4">
                                            <div>
                                                <h3 className="font-black text-lg text-slate-800">{employeeName}</h3>
                                                <p className="text-xs text-slate-500 font-bold uppercase">{selectedCell.dateStr}</p>
                                                {hasSwap && (
                                                    <div className="mt-2 text-[10px] font-black uppercase text-cyan-700 flex items-center gap-1">
                                                        <ArrowLeftRight size={12}/> Swap {shift?.swapWith ? `con ${shift.swapWith}` : ''} {shift?.swapDate ? `(${shift.swapDate})` : ''}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {shift && <button onClick={() => setCellEditMode(false)} className="p-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200" title="Volver a vista previa"><ChevronLeft size={16}/></button>}
                                                <button onClick={handleDelete} className="p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100" disabled={isServiceLocked}><Trash2 size={18}/></button>
                                            </div>
                                        </div>
                                        {francoRestHModal != null && (
                                            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-3">
                                                <Clock size={12}/>
                                                <span>Descanso total: <span className="font-black text-emerald-700">{francoRestHModal}h</span></span>
                                            </div>
                                        )}
                                        {selectedGrupo && grupoUnifiedMode && (() => {
                                            const _currentTarget = cellPlanningObjectiveId || selectedGrupo.objectiveIds[0];
                                            const _oi = selectedGrupo.objectiveIds.indexOf(_currentTarget);
                                            const _clr = GRUPO_COLOR_HEX[_oi % GRUPO_COLOR_HEX.length] || '#64748b';
                                            const _emp = employees.find((e: any) => e.id === selectedCell.empId);
                                            const _nativeObjId = _emp ? (
                                                selectedGrupo.objectiveIds.includes(_emp.preferredObjectiveId)
                                                    ? _emp.preferredObjectiveId
                                                    : (slaIdToObjId[_emp.preferredObjectiveId] && selectedGrupo.objectiveIds.includes(slaIdToObjId[_emp.preferredObjectiveId]) ? slaIdToObjId[_emp.preferredObjectiveId] : null)
                                            ) : null;
                                            const _isExternal = !_nativeObjId;
                                            return (
                                                <div className="mb-3">
                                                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">
                                                        Objetivo {_isExternal && <span className="text-amber-500 normal-case font-bold ml-1">(externo — elegí dónde planificar)</span>}
                                                    </label>
                                                    <select
                                                        className="w-full border p-2 rounded-lg text-xs font-bold"
                                                        style={{ borderColor: _clr, backgroundColor: _clr + '12', color: _clr }}
                                                        value={_currentTarget}
                                                        onChange={e => setCellTargetObjectiveId(e.target.value)}
                                                    >
                                                        {selectedGrupo.objectiveIds.map((objId: string, oi: number) => (
                                                            <option key={objId} value={objId}>{selectedGrupo.objectiveNames[oi]}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            );
                                        })()}
                                        <div className="mb-2">
                                            <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block flex items-center gap-2">
                                                Puesto / Función
                                                {renderPositionGeneroBadge(
                                                    effectivePosStructure.find((p: any) => p.positionName === (activePosition || effectivePosStructure[0]?.positionName))?.preferenciaGenero,
                                                )}
                                            </label>
                                            <select
                                                className="w-full bg-slate-50 border p-2 rounded-lg text-xs font-bold"
                                                value={activePosition || ''}
                                                id="positionSelector"
                                                disabled={isServiceLocked}
                                                onChange={(e) => setActivePosition(e.target.value)}
                                            >
                                                {effectivePosStructure.map(p => {
                                                    const excludedToday = isPosExcludedOnDate(p, selectedCell.dateStr);
                                                    return (
                                                    <option key={p.positionName} value={p.positionName} disabled={excludedToday}>
                                                        {p.positionName}{preferenciaGeneroOptionSuffix(p.preferenciaGenero)}{excludedToday ? ' — EXCLUIDO este día' : ''} ({p.qty} pax - Meta: {(p.activeDays?.includes(getDayLetter(selectedCell.dateStr)) && !excludedToday) ? dailyCoverageHoursTargetWithPerShiftPax(p, Number(p.qty) || 1, getDayLetter(selectedCell.dateStr), autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles, selectedCell.dateStr) : 0}h)
                                                    </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                        {(() => {
                                            const currentPosName = activePosition || effectivePosStructure[0]?.positionName || 'General';
                                            const posCfg = effectivePosStructure.find((p: any) => p.positionName === currentPosName);
                                            const generoUi = getPreferenciaGeneroUi(posCfg?.preferenciaGenero);
                                            if (!generoUi) return null;
                                            const emp = displayedEmployees.find((e: any) => e.id === selectedCell.empId);
                                            const generoCheck = emp ? checkGeneroPuesto(emp.genero, generoUi.pref) : { blocked: false };
                                            return (
                                                <div className={`mb-3 rounded-xl border-2 px-3 py-2.5 ${generoCheck.blocked ? 'border-rose-300 bg-rose-50' : generoUi.pref === 'F' ? 'border-pink-200 bg-pink-50' : 'border-blue-200 bg-blue-50'}`}>
                                                    <p className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${generoCheck.blocked ? 'text-rose-800' : generoUi.pref === 'F' ? 'text-pink-800' : 'text-blue-800'}`}>
                                                        {renderPositionGeneroBadge(generoUi.pref)}
                                                        Puesto {preferenciaGeneroLabel(generoUi.pref)}
                                                    </p>
                                                    <p className={`text-[10px] font-bold mt-1 leading-snug ${generoCheck.blocked ? 'text-rose-700' : generoUi.pref === 'F' ? 'text-pink-700' : 'text-blue-700'}`}>
                                                        {generoCheck.blocked && generoCheck.message
                                                            ? `${emp?.name || 'Empleado'}: ${generoCheck.message}`
                                                            : `Solo se puede asignar personal ${generoUi.pref === 'F' ? 'femenino' : 'masculino'} a este puesto (definido en Servicios/SLA).`}
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {(() => {
                                            const currentPosName = activePosition || effectivePosStructure[0]?.positionName || 'General';
                                            const posCfg = effectivePosStructure.find((p: any) => p.positionName === currentPosName);
                                            const isExcludedToday = isPosExcludedOnDate(posCfg, selectedCell.dateStr);
                                            if (!isExcludedToday) return null;
                                            return (
                                                <div className="mb-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                                                    <p className="text-[10px] font-black uppercase text-rose-800 flex items-center gap-1.5">
                                                        <Ban size={12}/> Día excluido por SLA
                                                    </p>
                                                    <p className="text-[10px] font-bold text-rose-700 mt-1 leading-snug">
                                                        El puesto <span className="font-black">{currentPosName}</span> no tiene servicio el {planningPositionExclusionLabel(selectedCell.dateStr)}.
                                                        Definido en Servicios → Días excluidos. Solo podés asignar Franco (F).
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {(() => {
                                            const coverageData = modalCoverageStats || {
                                                current: 0, target: 24, pax: 1, isActiveDay: true, isExcludedDay: false,
                                                closedUnits: 0, requiredUnits: 1, schemeLabel: '', isPositionClosed: false,
                                            };
                                            const currentPosName = activePosition || 'General';
                                            const posCfg = effectivePosStructure.find((p: any) => p.positionName === currentPosName);
                                            const isExcludedDay = coverageData.isExcludedDay;
                                            const isHoursCovered = coverageData.current >= coverageData.target;
                                            const isUnitsCovered = coverageData.isPositionClosed;
                                            const coverageFull = coverageData.isActiveDay && coverageData.requiredUnits > 0 && isUnitsCovered;
                                            const percentage = coverageData.target > 0 ? Math.min(100, (coverageData.current / coverageData.target) * 100) : 100;
                                            const displayTarget = isExcludedDay
                                                ? 'Excluido SLA'
                                                : coverageData.isActiveDay ? `${coverageData.target}h` : `Sin cobertura`;
                                            const unitsLabel = coverageData.isActiveDay && coverageData.requiredUnits > 0
                                                ? `${coverageData.closedUnits}/${coverageData.requiredUnits} puesto${coverageData.requiredUnits > 1 ? 's' : ''}`
                                                : null;
                                            const bgClass = isExcludedDay
                                                ? 'bg-rose-100 text-rose-700'
                                                : coverageData.isActiveDay
                                                ? (isUnitsCovered ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600')
                                                : 'bg-slate-100 text-slate-500';
                                            const barColor = isExcludedDay
                                                ? 'bg-rose-300'
                                                : coverageData.isActiveDay
                                                ? (isHoursCovered ? 'bg-emerald-500' : 'bg-rose-500')
                                                : 'bg-slate-300';
                                            return (
                                                <>
                                                    {correctionMode && renderDayCoverageClosures(selectedCell.dateStr, { compact: true })}
                                                    <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <Layers size={14} className="text-slate-400"/>
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                                                                    Cobertura {currentPosName}
                                                                    {renderPositionGeneroBadge(posCfg?.preferenciaGenero)}
                                                                </span>
                                                            </div>
                                                            {unitsLabel && (
                                                                <div className={`text-xs font-black px-2 py-0.5 rounded ${bgClass}`}>
                                                                    {unitsLabel}
                                                                    {coverageData.schemeLabel ? ` (${coverageData.schemeLabel})` : ''}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-[9px] text-slate-400 font-bold">Horas SLA</span>
                                                            <span className={`text-[10px] font-black ${isHoursCovered ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                {coverageData.current}h / {displayTarget}
                                                            </span>
                                                        </div>
                                                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }} />
                                                        </div>
                                                    </div>
                                                    <div className={`grid grid-cols-3 gap-2 mb-4 ${isServiceLocked || isExcludedDay ? 'opacity-50 pointer-events-none' : ''}`}>
                                                        {modalDayShifts.map((s: any) => {
                                                            const isBlocked = shiftButtonDisabledMap.has(String(s.code).toUpperCase());
                                                            const disabledByCoverage = coverageFull;
                                                            const disabled = isServiceLocked || isBlocked || disabledByCoverage || isExcludedDay;
                                                            const timeRange = (s.startTime && s.endTime) ? `${s.startTime}–${s.endTime}` : null;
                                                            const gap = coverageData.current + (Number(s.hours) || 0) - coverageData.target;
                                                            const blockTitle = isExcludedDay
                                                                ? 'Puesto excluido por SLA este día'
                                                                : disabledByCoverage
                                                                    ? (coverageData.schemeLabel
                                                                        ? `Puesto cerrado — esquema completo (${coverageData.schemeLabel}).`
                                                                        : 'Puesto cerrado — esquema SLA completo.')
                                                                : isBlocked
                                                                    ? 'Cupo lleno o esquema de cobertura ya completo para este turno'
                                                                    : undefined;
                                                            return (
                                                                <button
                                                                    key={s.code}
                                                                    onClick={() => !disabled && handleAssignShift(s, activePosition || 'General')}
                                                                    disabled={disabled}
                                                                    title={blockTitle}
                                                                    className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-transform relative ${disabled ? 'opacity-40 cursor-not-allowed grayscale' : 'hover:scale-105'} ${SHIFT_STYLES[s.code]}`}
                                                                >
                                                                    <span className="font-black text-sm">{s.code}</span>
                                                                    <span className="text-[9px] opacity-70">{s.hours}hs</span>
                                                                    {timeRange && <span className="text-[8px] opacity-60 font-mono leading-tight">{timeRange}</span>}
                                                                    {!selectedCell.currentShift && gap < 0 && !disabled && <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">{gap}h</div>}
                                                                </button>
                                                            );
                                                        })}
                                                        <button
                                                            onClick={() => { setFrancoMode('NONE'); handleAssignShift({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' }, 'General'); }}
                                                            disabled={isServiceLocked}
                                                            className={`p-2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg flex flex-col items-center justify-center font-black ${isExcludedDay ? 'relative z-10 opacity-100 pointer-events-auto' : ''}`}
                                                            title="Asignar Franco (F)"
                                                        >
                                                            <span>F</span><span className="text-[8px]">Franco</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignShift({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00' }, 'Retén')}
                                                            disabled={isServiceLocked}
                                                            className="p-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg flex flex-col items-center justify-center font-black"
                                                            title="Retén — guardia disponible sin turno asignado (horas tácitas, no suman al límite)"
                                                        >
                                                            <span>RET</span><span className="text-[8px]">Retén</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignDeployment('SURPLUS')}
                                                            disabled={isServiceLocked || !activePosition || activePosition === 'General' || activePosition === 'Retén'}
                                                            className="p-2 bg-violet-100 text-violet-800 border border-violet-300 rounded-lg flex flex-col items-center justify-center font-black disabled:opacity-40"
                                                            title="Refuerzo — puesto ya cubierto; no suma cobertura SLA"
                                                        >
                                                            <span>REF</span><span className="text-[8px]">Refuerzo</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignDeployment('TRAINING')}
                                                            disabled={isServiceLocked || !activePosition || activePosition === 'General' || activePosition === 'Retén'}
                                                            className="p-2 bg-sky-100 text-sky-800 border border-sky-300 rounded-lg flex flex-col items-center justify-center font-black disabled:opacity-40"
                                                            title="Escuela — formación en objetivo (3 turnos = conocido)"
                                                        >
                                                            <span>ESC</span><span className="text-[8px]">Escuela</span>
                                                        </button>
                                                        {/* Botón EV: aparece si hay servicios de evento activos ese día */}
                                                        {(() => {
                                                            const cellKey = `${selectedCell.empId}_${selectedCell.dateStr}`;
                                                            const srvsDia = serviciosParaFecha(eventos, selectedCell.dateStr, true);
                                                            if (srvsDia.length === 0) return null;
                                                            const isPickerOpen = eventoPickerKey === cellKey;
                                                            const countAssignedForService = (servicioId: string) => {
                                                                return displayedEmployees.reduce((acc: number, emp: any) => {
                                                                    const shift = resolveCellShiftAtObjective(
                                                                        emp.id,
                                                                        selectedCell.dateStr,
                                                                        selectedObjective,
                                                                        pendingChanges,
                                                                        shiftsMap,
                                                                    );
                                                                    if (!shift || shift.isDeleted) return acc;
                                                                    const code = String(shift.code || shift.type || '').toUpperCase();
                                                                    if (code !== 'EV') return acc;
                                                                    if (String(shift.servicioId || '') !== String(servicioId)) return acc;
                                                                    return acc + 1;
                                                                }, 0);
                                                            };
                                                            const assignServicio = async ({ evento, servicio }: { evento: Evento; servicio: ServicioEvento }) => {
                                                                if (isServiceLocked) return;
                                                                const guardHours = servicio.tipoTurno === '3x8' ? 8
                                                                    : servicio.tipoTurno === '2x12' ? 12
                                                                    : calcHorasEvento(servicio.horaInicio, servicio.horaFin);
                                                                const emp = (displayedEmployees as any[]).find((e: any) => e.id === selectedCell.empId);
                                                                const empNombre = emp?.name || selectedCell.empId;
                                                                const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
                                                                const current = pendingChanges[key]?.isDeleted
                                                                    ? null
                                                                    : (pendingChanges[key] || selectedCell.currentShift);
                                                                const currentCode = String(current?.code || current?.type || '').toUpperCase();
                                                                const alreadySameService = currentCode === 'EV'
                                                                    && String(current?.servicioId || '') === String(servicio.id)
                                                                    && String(current?.eventoId || '') === String(evento.id || '');
                                                                if (alreadySameService) {
                                                                    toast.info('Ese guardia ya está asignado a este servicio en borrador');
                                                                    setEventoPickerKey(null);
                                                                    return;
                                                                }
                                                                const assigned = countAssignedForService(servicio.id);
                                                                const replacingThisService = currentCode === 'EV'
                                                                    && String(current?.servicioId || '') === String(servicio.id);
                                                                const effectiveAssigned = replacingThisService ? Math.max(0, assigned - 1) : assigned;
                                                                if (servicio.cupo > 0 && effectiveAssigned >= servicio.cupo) {
                                                                    toast.error(`Cupo completo para ${servicio.nombre} (${effectiveAssigned}/${servicio.cupo})`);
                                                                    return;
                                                                }
                                                                const coveredPosition = activePosition || current?.positionName || 'General';
                                                                applyToPending({
                                                                    code: 'EV',
                                                                    name: 'Evento',
                                                                    hours: guardHours,
                                                                    startTime: servicio.horaInicio || '08:00',
                                                                    endTime: servicio.horaFin || '16:00',
                                                                    positionName: coveredPosition,
                                                                    eventoId: evento.id,
                                                                    eventoNombre: evento.nombre,
                                                                    servicioId: servicio.id,
                                                                    servicioNombre: servicio.nombre,
                                                                    comments: `Evento: ${evento.nombre} · ${servicio.nombre}`,
                                                                    isFrancoTrabajado: false,
                                                                    isFrancoCompensatorio: false,
                                                                    isExtended: false,
                                                                    isEarlyStart: false,
                                                                });
                                                                setEventoPickerKey(null);
                                                            };
                                                            const buttonLabel = (() => {
                                                                if (srvsDia.length !== 1) return `${srvsDia.length} servicios`;
                                                                const one = srvsDia[0];
                                                                const assigned = countAssignedForService(one.servicio.id);
                                                                const left = one.servicio.cupo > 0 ? Math.max(0, one.servicio.cupo - assigned) : null;
                                                                const base = `${one.evento.nombre} · ${one.servicio.nombre}`;
                                                                return left == null ? base : `${base} (${assigned}/${one.servicio.cupo})`;
                                                            })();
                                                            return (
                                                                <div className="col-span-3">
                                                                    <button
                                                                        onClick={() => {
                                                                            if (isServiceLocked) return;
                                                                            if (srvsDia.length === 1) {
                                                                                void assignServicio(srvsDia[0]);
                                                                            } else {
                                                                                setEventoPickerKey(isPickerOpen ? null : cellKey);
                                                                            }
                                                                        }}
                                                                        disabled={isServiceLocked}
                                                                        className="w-full p-2 bg-yellow-400 text-yellow-900 border border-yellow-500 rounded-lg flex items-center justify-center gap-2 font-black disabled:opacity-40"
                                                                        title="Asignar turno Evento"
                                                                    >
                                                                        <span>EV</span>
                                                                        <span className="text-[9px] font-bold truncate max-w-[120px]">
                                                                            {buttonLabel}
                                                                        </span>
                                                                    </button>
                                                                    {isPickerOpen && srvsDia.length > 1 && (
                                                                        <div className="mt-1 flex flex-col gap-1 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-2 max-h-48 overflow-y-auto">
                                                                            {srvsDia.map(({ evento, servicio }) => {
                                                                                const assigned = countAssignedForService(servicio.id);
                                                                                const cupoLleno = servicio.cupo > 0 && assigned >= servicio.cupo;
                                                                                const horarioBadge = servicio.tipoTurno === '3x8'
                                                                                    ? '3×8h'
                                                                                    : servicio.tipoTurno === '2x12'
                                                                                        ? '2×12h'
                                                                                        : `${servicio.horaInicio}–${servicio.horaFin}`;
                                                                                return (
                                                                                    <button
                                                                                        key={servicio.id}
                                                                                        disabled={cupoLleno}
                                                                                        onClick={() => { void assignServicio({ evento, servicio }); }}
                                                                                        className={`text-left px-2 py-2 rounded text-xs font-bold border-b border-yellow-100 last:border-0 ${
                                                                                            cupoLleno ? 'text-slate-400 bg-slate-100 cursor-not-allowed' : 'text-yellow-900 hover:bg-yellow-200'
                                                                                        }`}
                                                                                    >
                                                                                        <div className="flex items-center justify-between gap-2">
                                                                                            <span className="font-black truncate">{servicio.nombre}</span>
                                                                                            <span className="text-[9px] font-normal opacity-60 whitespace-nowrap shrink-0">{evento.nombre}</span>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-1.5 mt-0.5 font-normal text-[10px] opacity-70">
                                                                                            <span className="px-1 py-0.5 bg-yellow-300 rounded text-[9px] font-bold">{horarioBadge}</span>
                                                                                            {servicio.cupo > 0 && <span>{assigned}/{servicio.cupo} pax</span>}
                                                                                            {cupoLleno && <span className="text-rose-500 font-bold">Cupo completo</span>}
                                                                                        </div>
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </>
                                            );
                                        })()}
                                        <div className={`flex flex-col gap-2 mb-4 ${isServiceLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                            {(() => {
                                                const extKey = `${selectedCell.empId}_${selectedCell.dateStr}`;
                                                const extShift = pendingChanges[extKey]?.isDeleted
                                                    ? null
                                                    : (pendingChanges[extKey] || selectedCell.currentShift);
                                                const canExtendCell = isShiftEligibleForExtension(extShift) && !isConsolidated;
                                                return canExtendCell ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const dateStr = selectedCell.dateStr;
                                                            const homePos = String(extShift?.positionName || activePosition || 'General');
                                                            const gapPos = resolveSuggestedGapPositionForDay(dateStr, homePos);
                                                            setShiftExtendModal({
                                                                empId: selectedCell.empId,
                                                                empName: employeeName,
                                                                dateStr,
                                                                gapPositionName: gapPos,
                                                                suggestedGapBand: resolveSuggestedGapBandForPosition(dateStr, gapPos),
                                                            });
                                                        }}
                                                        className="w-full py-2.5 rounded-xl text-xs font-black border-2 border-red-200 bg-red-50 text-red-800 hover:bg-red-100 flex items-center justify-center gap-2"
                                                    >
                                                        <Timer size={14} /> Extender jornada (+horas)
                                                    </button>
                                                ) : null;
                                            })()}
                                            <button
                                                type="button"
                                                onClick={() => setRecompositionModalOpen(true)}
                                                disabled={!selectedCell?.dateStr}
                                                className="w-full py-2.5 rounded-xl text-xs font-black border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center justify-center gap-2 disabled:opacity-40"
                                            >
                                                <Split size={14} /> Cobertura / Liberación (ext + adel)
                                            </button>
                                        </div>
                                        <button onClick={() => { setSwapConfig({ empId: selectedCell.empId }); setShowSwapModal(true); }} disabled={isServiceLocked} className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-50"><ArrowLeftRight size={16}/> Iniciar Enroque / Cambio de Turno</button>
                                        <div className="mt-2 px-2"><button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-rose-500 flex items-center justify-center gap-1 disabled:opacity-50">Aplicar a Selección (Borrar)</button></div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {pendingAssignment && createPortal(<div className="fixed inset-0 z-[11000] bg-amber-900/40 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl border-2 border-amber-400 animate-in zoom-in-95"><div className="flex flex-col items-center text-center space-y-4"><div className="p-4 bg-amber-100 rounded-full text-amber-600"><AlertTriangle size={32} /></div><div><h3 className="font-black text-lg text-amber-800 uppercase">Advertencia Laboral</h3><p className="text-xs text-slate-600 mt-2 font-medium">{authWarningMessage}</p></div><div className="w-full pt-4 border-t flex gap-3"><button type="button" onClick={cancelPendingAssignment} className="flex-1 py-3 text-slate-500 font-bold text-xs rounded-xl hover:bg-slate-100">Cancelar</button><button type="button" onClick={confirmPendingAssignment} className="flex-1 py-3 bg-amber-500 text-white font-black text-xs rounded-xl hover:bg-amber-600 shadow-md">Aplicar</button></div></div></div></div>, document.body)}
                {publishConfirmModal && typeof document !== 'undefined' && createPortal(
                    <div
                        className="fixed inset-0 z-[9200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
                        onClick={() => !isPublishing && !publishConfirmPinChecking && setPublishConfirmModal(null)}
                    >
                        <div
                            className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="p-5 border-b bg-indigo-50/80">
                                <div className="flex items-start gap-3">
                                    <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl shrink-0">
                                        <CalendarCheck size={22}/>
                                    </div>
                                    <div>
                                        <h3 className="font-black text-base text-slate-900 uppercase tracking-wide">
                                            {publishConfirmModal.isRepublish ? 'Re-publicar cronograma' : 'Publicar cronograma'}
                                        </h3>
                                        <p className="text-[11px] font-bold text-indigo-700 mt-0.5">
                                            {publishConfirmModal.objectiveName} · {publishConfirmModal.periodLabel}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-5 space-y-3">
                                <p className="text-sm text-slate-700 leading-relaxed">
                                    {publishConfirmModal.isRepublish
                                        ? '¿Está seguro de re-publicar este cronograma? Se volverán a enviar notificaciones a los colaboradores con los turnos en borrador del mes.'
                                        : '¿Está seguro de publicar este cronograma? Los colaboradores del objetivo recibirán notificaciones con sus turnos asignados.'}
                                </p>
                                <ul className="text-[11px] text-slate-500 space-y-1.5 list-disc pl-4">
                                    <li>El cronograma quedará visible en el portal del guardia.</li>
                                    <li>Los turnos en borrador pasan a estado publicado.</li>
                                    <li>Esta acción no se puede deshacer con un clic (solo SuperAdmin puede despublicar).</li>
                                </ul>
                                {publishConfirmModal.superAdminOverride && publishConfirmModal.warnings.length > 0 && (
                                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                                        <p className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1">
                                            <ShieldAlert size={12}/> SuperAdmin — publicación con advertencias
                                        </p>
                                        {publishConfirmModal.warnings.map((w, i) => (
                                            <p key={i} className="text-[11px] font-medium text-amber-900">{w}</p>
                                        ))}
                                    </div>
                                )}
                                {(Object.keys(pendingChanges).length > 0 || backgroundSaveCount > 0) && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                                        <p className="text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
                                            <AlertTriangle size={13}/>
                                            {backgroundSaveCount > 0
                                                ? 'Hay un guardado en segundo plano. Esperá a que termine antes de publicar.'
                                                : `Tenés ${Object.keys(pendingChanges).length} cambio(s) sin guardar. Guardá antes de publicar para que entren en las notificaciones.`}
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-3">
                                    <label className="text-[10px] font-black text-indigo-700 uppercase tracking-wider block mb-2 text-center">
                                        PIN de supervisor (obligatorio)
                                    </label>
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={4}
                                        value={publishConfirmPin}
                                        onChange={(e) => {
                                            setPublishConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                                            setPublishConfirmPinError('');
                                        }}
                                        placeholder="••••"
                                        className="w-full text-center text-2xl font-black tracking-[0.4em] py-2.5 rounded-xl border-2 border-indigo-200 focus:border-indigo-500 outline-none bg-white"
                                    />
                                    {publishConfirmPinError && (
                                        <p className="text-[11px] font-bold text-rose-600 text-center mt-2">{publishConfirmPinError}</p>
                                    )}
                                    <p className="text-[10px] text-slate-500 text-center mt-2">
                                        La asignación de puestos no publica el cronograma. Solo este paso lo hace.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border-t bg-slate-50 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPublishConfirmModal(null);
                                        setPublishConfirmPin('');
                                        setPublishConfirmPinError('');
                                    }}
                                    disabled={isPublishing || publishConfirmPinChecking}
                                    className="flex-1 py-3 rounded-xl text-xs font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (Object.keys(pendingChanges).length > 0 || backgroundSaveCount > 0) return;
                                        setPublishConfirmPinChecking(true);
                                        setPublishConfirmPinError('');
                                        try {
                                            const auth = await verifySupervisorPin(publishConfirmPin);
                                            if (!auth.ok) {
                                                setPublishConfirmPinError('PIN incorrecto. Intentá de nuevo.');
                                                return;
                                            }
                                            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                                                action: 'AUTORIZACION_PUBLICAR_CRONOGRAMA',
                                                module: 'PLANIFICADOR',
                                                details: `PIN OK (${auth.name}) · ${publishConfirmModal.isRepublish ? 're-publicar' : 'publicar'} · ${publishConfirmModal.objectiveName} · ${publishConfirmModal.periodLabel}`,
                                                timestamp: serverTimestamp(),
                                                actorName: activeActorName || operatorName,
                                                actorUid: getAuth().currentUser?.uid,
                                                objectiveId: selectedObjective,
                                                objectiveName: publishConfirmModal.objectiveName,
                                            }, empresaId));
                                            setPublishConfirmPin('');
                                            await executePublish();
                                        } catch {
                                            setPublishConfirmPinError('No se pudo validar el PIN.');
                                        } finally {
                                            setPublishConfirmPinChecking(false);
                                        }
                                    }}
                                    disabled={isPublishing || publishConfirmPinChecking || Object.keys(pendingChanges).length > 0 || backgroundSaveCount > 0 || publishConfirmPin.length !== 4}
                                    className="flex-1 py-3 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                >
                                    {(isPublishing || publishConfirmPinChecking) ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
                                    {publishConfirmModal.isRepublish ? 'Re-publicar' : 'Publicar'}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
                {deployBandPicker && createPortal(
                    <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDeployBandPicker(null)}>
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl w-full max-w-sm border dark:border-slate-700" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-sm uppercase mb-1 text-slate-800 dark:text-white">
                                {deployBandPicker === 'TRAINING' ? 'Escuela — elegir turno del puesto' : 'Refuerzo — elegir turno del puesto'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mb-4 flex items-center gap-2 flex-wrap">
                                Puesto: <span className="font-bold text-indigo-600">{activePosition}</span>
                                {renderPositionGeneroBadge(
                                    positionStructure.find((p: any) => p.positionName === activePosition)?.preferenciaGenero,
                                )}
                            </p>
                            {deployBandOptions.length === 0 ? (
                                <p className="text-[11px] text-rose-600 font-bold mb-3">
                                    Este puesto no tiene turnos SLA activos para el día. Revisá el servicio / días excluidos.
                                </p>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    {deployBandOptions.map((b) => {
                                        const hrs = Number(b.hours) > 0 ? Number(b.hours) : undefined;
                                        const timeRange = b.startTime
                                            ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ''}`
                                            : null;
                                        return (
                                            <button
                                                key={b.code}
                                                onClick={() => confirmDeploymentBand(b.code, b)}
                                                className={`p-3 rounded-lg border font-black text-sm flex flex-col items-center gap-0.5 ${SHIFT_STYLES[b.code] || 'bg-slate-100 text-slate-800 border-slate-200'}`}
                                            >
                                                <span>{b.code}</span>
                                                {hrs != null && <span className="text-[9px] opacity-70 font-bold">{hrs}hs</span>}
                                                {timeRange && <span className="text-[8px] opacity-60 font-mono">{timeRange}</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <button onClick={() => setDeployBandPicker(null)} className="w-full mt-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
                        </div>
                    </div>,
                    document.body,
                )}
                {bulkDeployPicker && createPortal(
                    <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setBulkDeployPicker(null)}>
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl w-full max-w-sm border dark:border-slate-700" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-sm uppercase mb-1 text-slate-800 dark:text-white">
                                {bulkDeployPicker.intent === 'TRAINING' ? 'Escuela masiva — turno del puesto' : 'Refuerzo masivo — turno del puesto'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mb-4">
                                Puesto: <span className="font-bold text-indigo-600">{bulkDeployPicker.positionName}</span>
                                {bulkDeployPicker.onlyEmpId ? ' · un colaborador' : ' · selección completa'}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                {bulkDeployPicker.bands.map((b) => {
                                    const hrs = Number(b.hours) > 0 ? Number(b.hours) : undefined;
                                    const timeRange = b.startTime
                                        ? `${b.startTime}${b.endTime ? `–${b.endTime}` : ''}`
                                        : null;
                                    return (
                                        <button
                                            key={b.code}
                                            onClick={() => confirmBulkDeployBand(b.code, b)}
                                            className={`p-3 rounded-lg border font-black text-sm flex flex-col items-center gap-0.5 ${SHIFT_STYLES[b.code] || 'bg-slate-100 text-slate-800 border-slate-200'}`}
                                        >
                                            <span>{b.code}</span>
                                            {hrs != null && <span className="text-[9px] opacity-70 font-bold">{hrs}hs</span>}
                                            {timeRange && <span className="text-[8px] opacity-60 font-mono">{timeRange}</span>}
                                        </button>
                                    );
                                })}
                            </div>
                            <button onClick={() => setBulkDeployPicker(null)} className="w-full mt-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
                        </div>
                    </div>,
                    document.body,
                )}
                {showConflictModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-rose-900/20 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl w-[400px] border-2 border-rose-100"><div className="text-center mb-6"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3"><Siren size={24}/></div><h3 className="text-lg font-black text-slate-800">Conflicto Detectado</h3><p className="text-xs text-slate-500 mt-1">Hay una superposición entre Novedad y Turno.</p></div><div className="space-y-3"><button onClick={() => resolveConflict('SPLIT')} className="w-full p-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex items-center justify-center gap-2"><Split size={16}/> Dividir Turno (Extensión + Adelanto)</button><button onClick={() => resolveConflict('FULL_COVERAGE')} className="w-full p-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2"><Shield size={16}/> Cobertura Total (Franco Trabajado)</button><button onClick={() => setShowConflictModal(false)} className="w-full p-3 text-slate-400 font-bold text-xs hover:text-slate-600">Cancelar</button></div></div></div>)}
                {showSwapModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-[500px]">
                            <h3 className="font-black text-lg mb-4 flex items-center gap-2">
                                <ArrowLeftRight size={20} className="text-indigo-500" /> Intercambio de Turno
                            </h3>
                            <>
                                <input
                                    type="text"
                                    placeholder="Nombre, apellido o legajo…"
                                    className="w-full bg-slate-50 border p-3 rounded-xl mb-3 text-sm font-bold"
                                    value={swapSearchTerm}
                                    onChange={e => setSwapSearchTerm(e.target.value)}
                                />
                                <div className="max-h-60 overflow-y-auto custom-scrollbar border rounded-xl mb-4">
                                    {swapCandidates.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => { setSelectedSwapTarget(c.id); setSelectedSwapDate(''); }}
                                            className={`w-full p-3 text-left hover:bg-slate-50 border-b flex justify-between items-center ${selectedSwapTarget === c.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'}`}
                                        >
                                            <span>{c.name}</span>
                                            {selectedSwapTarget === c.id && <CheckCircle size={16} />}
                                        </button>
                                    ))}
                                </div>

                                {selectedSwapTarget && (
                                    <div className="bg-white border rounded-xl p-3 mb-4">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Elegir día del compañero</div>
                                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                                            {daysInMonth.map((d) => {
                                                const dateStr = getDateKey(d);
                                                if (isPlanningDateLocked(dateStr)) return null;
                                                const shift = getShiftFor(selectedSwapTarget, dateStr);
                                                if (!shift) return null;
                                                const selectedDay = selectedSwapDate === dateStr;
                                                return (
                                                    <button
                                                        key={dateStr}
                                                        onClick={() => handleSelectDate(dateStr)}
                                                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${selectedDay ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-indigo-50'}`}
                                                    >
                                                        {d.getDate()}/{d.getMonth() + 1} {(shift.code || shift.type) || '-'}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="bg-slate-50 p-3 rounded-xl border text-xs text-slate-600 mb-3">
                                    <div className="font-black text-slate-700 mb-1">Día: {selectedCell?.dateStr}</div>
                                    <div className="flex justify-between">
                                        <span>{employees.find(e => e.id === selectedCell?.empId)?.name || 'Empleado'}</span>
                                        <span className="font-mono">{(getShiftFor(selectedCell?.empId, selectedCell?.dateStr)?.code) || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>{employees.find(e => e.id === selectedSwapTarget)?.name || 'Compañero'}</span>
                                        <span className="font-mono">{(getShiftFor(selectedSwapTarget, selectedSwapDate || selectedCell?.dateStr)?.code) || '-'}</span>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button onClick={() => { setShowSwapModal(false); setSelectedSwapTarget(''); setSelectedSwapDate(''); setSwapSearchTerm(''); }} className="flex-1 py-3 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200">
                                        Cancelar
                                    </button>
                                    <button onClick={executeSwap} disabled={!selectedSwapTarget} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 disabled:opacity-50">
                                        Confirmar Intercambio
                                    </button>
                                </div>
                            </>
                        </div>
                    </div>
                )}
                {showAddModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setShowAddModal(false); setAddSearchTerm(''); }}>
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[440px]" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-lg mb-1">Asignar Colaborador</h3>
                            <p className="text-xs text-slate-400 font-bold mb-2">
                                {addSearchTerm.trim()
                                    ? <>Busca en toda la plantilla. Al elegir se asigna a <span className="text-indigo-600">{getObjectiveName(selectedObjective)}</span>.</>
                                    : <>Cercanos a ≤{nearbyKmRadius} km. Escribí para buscar en toda la plantilla.</>}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                                <MapPin size={12} className="text-amber-600 shrink-0"/>
                                {ROSTER_KM_PRESETS.map((km) => (
                                    <button
                                        key={km}
                                        type="button"
                                        onClick={() => persistNearbyKm(km)}
                                        className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${nearbyKmRadius === km ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700'}`}
                                    >
                                        {km} km
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    min={DOTACION_NEARBY_KM_MIN}
                                    max={DOTACION_NEARBY_KM_MAX}
                                    value={nearbyKmDraft}
                                    onChange={e => setNearbyKmDraft(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') persistNearbyKm(parseInt(nearbyKmDraft, 10));
                                    }}
                                    onBlur={() => persistNearbyKm(parseInt(nearbyKmDraft, 10))}
                                    className="w-12 text-center text-[11px] font-black bg-slate-50 border border-slate-200 rounded-lg px-1 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    title={`Radio ${DOTACION_NEARBY_KM_MIN}–${DOTACION_NEARBY_KM_MAX} km`}
                                />
                            </div>
                            <input
                                autoFocus
                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl mb-3 text-sm font-bold"
                                placeholder="Nombre, apellido o legajo…"
                                value={addSearchTerm}
                                onChange={e => setAddSearchTerm(e.target.value)}
                            />
                            <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
                                {addModalEmployeeCandidates.length === 0 && (
                                    <p className="text-xs text-slate-400 font-bold px-1 py-4 text-center">
                                        {addSearchTerm.trim() ? 'Sin coincidencias en la plantilla' : `No hay cercanos a ≤${nearbyKmRadius} km. Ampliá el radio o escribí un nombre.`}
                                    </p>
                                )}
                                {addModalEmployeeCandidates.map(emp => {
                                    const alreadyAssigned = emp.preferredObjectiveId === selectedObjective;
                                    const objLat = Number(selectedObjectiveData?.lat ?? 0);
                                    const objLng = Number(selectedObjectiveData?.lng ?? 0);
                                    const km = (objLat && objLng) ? employeeKmToObjective(emp, objLat, objLng) : null;
                                    const home = alreadyAssigned ? null : getObjectiveName(emp.preferredObjectiveId);
                                    return (
                                        <button
                                            key={emp.id}
                                            onClick={async () => {
                                                if (!emp.id) return;
                                                await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective });
                                                setAddSearchTerm('');
                                                setShowAddModal(false);
                                                toast.success(`${emp.name} asignado a ${getObjectiveName(selectedObjective)}`);
                                            }}
                                            className="w-full p-3 text-left hover:bg-indigo-50 rounded-lg flex items-center gap-3 text-sm font-medium text-slate-700 group"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-black text-xs text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">
                                                {String(emp.name || '').substring(0, 2)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold truncate">{emp.name}</div>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                                                    {emp.fileNumber && <span className="font-mono">{emp.fileNumber}</span>}
                                                    {alreadyAssigned && <span className="text-emerald-600 font-black">Ya asignado aquí</span>}
                                                    {!alreadyAssigned && home && home !== 'Desconocido' && <span className="truncate">{home}</span>}
                                                    {km != null && <span className="text-amber-600 shrink-0">{formatKmLabel(km)}</span>}
                                                </div>
                                            </div>
                                            {alreadyAssigned && <CheckCircle size={14} className="text-emerald-500 shrink-0"/>}
                                        </button>
                                    );
                                })}
                            </div>
                            {addSearchTerm.trim() && addModalMatchCount > addModalEmployeeCandidates.length && (
                                <p className="text-[10px] font-bold text-slate-400 mt-2">
                                    Mostrando {addModalEmployeeCandidates.length} de {addModalMatchCount}. Seguí escribiendo para acotar.
                                </p>
                            )}
                        </div>
                    </div>
                )}
                {showVacancyModal && (() => {
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
                })()}
                {showRRHHModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl w-[400px]"><h3 className="font-black text-lg mb-4">Registrar Novedad RRHH</h3><div className="space-y-4"><div><label className="text-xs font-bold text-slate-500 block mb-1">Tipo de Novedad</label><select className="w-full border p-2 rounded-lg" value={rrhhData.type} onChange={e => setRrhhData({...rrhhData, type: e.target.value})}><option>Vacaciones</option><option>Enfermedad</option><option>ART</option><option>Injustificada</option><option>Licencia Esp.</option></select></div><div><label className="text-xs font-bold text-slate-500 block mb-1">Detalle / Motivo</label><textarea className="w-full border p-2 rounded-lg h-24 text-sm" value={rrhhData.reason} onChange={e => setRrhhData({...rrhhData, reason: e.target.value})} placeholder="Especifique el motivo..."></textarea></div><button onClick={handleRRHHSubmit} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Guardar Novedad</button><button onClick={() => setShowRRHHModal(false)} className="w-full text-slate-400 text-xs font-bold py-2">Cancelar</button></div></div></div>)}
                {showHistoryModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)}><div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-black text-lg flex items-center gap-2"><History className="text-indigo-600"/> Historial de Versiones</h3><button onClick={() => setShowHistoryModal(false)}><X size={20}/></button></div><p className="px-4 py-2 text-[10px] text-slate-500 border-b bg-slate-50">Cada versión se compara con la <span className="font-bold text-indigo-600">planificación activa</span> (guardada + pendientes).</p><div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">{historyVersions.map(v => (<div key={v.id} className="border p-4 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-colors group"><div><p className="font-black text-slate-800 text-sm">{new Date(v.timestamp.seconds*1000).toLocaleString()}</p><p className="text-xs text-slate-500 font-mono mt-1">Modificado por: <span className="font-bold text-indigo-600">{v.user}</span></p><div className="mt-2 flex gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600 border border-slate-200">{v.count} cambios</span></div></div><button onClick={() => handleViewSnapshot(v)} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all">Comparar vs actual</button></div>))}{historyVersions.length === 0 && <div className="text-center text-slate-400 py-10">No hay versiones guardadas para este periodo.</div>}</div></div></div>)}

                {/* MODAL AUTORIZACIÓN SUPERVISOR 200H */}
                {authModal.pendingFn && createPortal(
                    <div className="fixed inset-0 z-[11000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
                        <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md p-8 shadow-2xl animate-in zoom-in-95 border dark:border-slate-700">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-amber-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <ShieldAlert size={32} className="text-amber-600"/>
                                </div>
                                <h3 className="font-black text-xl text-slate-900 dark:text-white">Autorización Requerida</h3>
                                <p className="text-sm text-slate-500 mt-1">{authModal.description || <>El siguiente empleado superará las <strong>200 hs</strong> mensuales:</>}</p>
                                <div className="mt-3 flex flex-col gap-1 items-center">
                                    {authModal.employees.map(e => (
                                        <span key={`${e.name}-${e.detail || e.hours}`} className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-bold">
                                            {e.name}
                                            {e.detail
                                                ? <> — <span className="text-amber-900">{e.detail}</span></>
                                                : e.hours
                                                    ? <> — <span className="text-amber-900">{e.hours}h</span></>
                                                    : null}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); void submitSupervisorAuth(); }}>
                                <div className="mb-6">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2 text-center">PIN de Supervisor</label>
                                    <SupervisorPinInput
                                        autoFocus
                                        maxLength={4}
                                        placeholder="••••"
                                        value={authPin}
                                        onChange={e => { setAuthPin(e.target.value.replace(/\D/g,'').slice(0,4)); setAuthError(''); }}
                                        className="w-full text-center text-3xl font-black tracking-[0.6em] bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-indigo-500 outline-none dark:text-white rounded-xl px-4 py-4"
                                    />
                                    {authError && <p className="text-rose-600 text-xs font-bold text-center mt-2">{authError}</p>}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => { setAuthModal({ pendingFn: null, employees: [] }); setAuthPin(''); setAuthError(''); }}
                                        className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={authPin.length !== 4 || authLoading}
                                        className="flex-1 py-3 bg-indigo-600 disabled:bg-slate-300 text-white rounded-xl font-black uppercase text-xs hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        {authLoading ? <RefreshCw size={16} className="animate-spin"/> : <ShieldCheck size={16}/>}
                                        AUTORIZAR
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                , document.body)}

                {showHoursBreakdownModal && selectedObjective && (
                    <PlanningHoursBreakdownModal
                        selectedObjective={selectedObjective}
                        selectedGrupo={selectedGrupo}
                        grupoUnifiedMode={grupoUnifiedMode}
                        getObjectiveName={getObjectiveName}
                        breakdown={planningMonthHoursBreakdown}
                        employeeMonthlyHours={empMonthlyHours}
                        slaVendidas={slaVendidas}
                        grupoTotalVendidas={grupoTotalVendidas}
                        auxiliarySummary={planningAuxiliarySummary}
                        grupoObjectiveBillableHours={grupoObjectiveBillableHours}
                        grupoVendidasByObjective={grupoVendidasByObjective}
                        onClose={() => setShowHoursBreakdownModal(false)}
                    />
                )}

                {/* ── MODAL CAPACIDAD CCT POR EMPLEADO ── */}
                {showCapacityModal && autoV2GenStats && (
                    <PlanningCctCapacityModal
                        stats={autoV2GenStats}
                        displayedEmployees={displayedEmployees}
                        currentDate={currentDate}
                        monthlyLimit={planningLimits.monthly}
                        onClose={() => setShowCapacityModal(false)}
                    />
                )}

                {/* ── Modal cobertura de ausencias (planificación) ── */}
                {planCoverageModalGaps.length > 0 && (() => {
                    const bandMeta: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
                        M:   { name: 'Mañana',   hours: 8,  startTime: '07:00', endTime: '15:00' },
                        T:   { name: 'Tarde',    hours: 8,  startTime: '15:00', endTime: '23:00' },
                        N:   { name: 'Noche',    hours: 8,  startTime: '23:00', endTime: '07:00' },
                        D12: { name: 'Diurno',   hours: 12, startTime: '07:00', endTime: '19:00' },
                        N12: { name: 'Nocturno', hours: 12, startTime: '19:00', endTime: '07:00' },
                    };
                    const objectiveEmpIds = new Set(planningDotacionEmployees.map((e: any) => e.id));
                    return (
                        <PlanningCoverageModal
                            gaps={planCoverageModalGaps}
                            objectiveEmpIds={objectiveEmpIds}
                            objLat={selectedObjectiveData?.lat ?? null}
                            objLng={selectedObjectiveData?.lng ?? null}
                            objectiveId={selectedObjective}
                            pendingChanges={pendingChanges}
                            shiftsMap={shiftsMap}
                            empresaId={empresaId || ''}
                            positionName={positionStructure[0]?.positionName ?? 'General'}
                            onAssignExternal={(empId, nombre) => {
                                const updates: Record<string, any> = {};
                                const gapKeys: string[] = [];
                                for (const gap of planCoverageModalGaps) {
                                    const meta = bandMeta[gap.band] ?? bandMeta.M;
                                    updates[`${empId}_${gap.dateStr}`] = {
                                        isTemp: true,
                                        employeeId: empId,
                                        objectiveId: selectedObjective,
                                        positionName: gap.positionName || positionStructure[0]?.positionName || 'General',
                                        code: gap.band,
                                        name: meta.name,
                                        hours: meta.hours,
                                        startTime: meta.startTime,
                                        endTime: meta.endTime,
                                        isFranco: false,
                                    };
                                    // Marcar la celda del ausente con quién lo cubre → aparece en "4. CUBIERTO POR"
                                    const absentKey = `${gap.absentEmpId}_${gap.dateStr}`;
                                    const existingAbsent = pendingChanges[absentKey] || shiftsMap[absentKey] || {};
                                    updates[absentKey] = { ...existingAbsent, coveredBy: nombre };
                                    gapKeys.push(absentKey);
                                }
                                const n = planCoverageModalGaps.length;
                                setPendingChanges(prev => ({ ...prev, ...updates }));
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: empId, coveredByName: nombre }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                // Cobertura externa: cada día asignado agrega horas de la banda (N=8h, M=8h, T=8h)
                                const bandHrs = bandMeta[planCoverageModalGaps[0]?.band ?? 'N']?.hours ?? 8;
                                applyCoverageToStats(n, n * bandHrs);
                                toast.success(`${nombre.split(',')[0]} asignado a ${n} día(s) (+${n * bandHrs}h)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onAssignD12={() => {
                                // D12 interno: D12 + N12 = cubre las 24hs con 2 guardias en vez de 3 (M+T+N).
                                // Cada banda ausente requiere DOS cambios en la grilla:
                                //   N ausente → T→N12 (cubre 19-07) + M→D12 (cubre 07-19, reemplaza el T vacante)
                                //   M ausente → T→D12 (cubre 07-19) + N→N12 (cubre 19-07, reemplaza el T vacante)
                                //   T ausente → M→D12 (cubre 07-19) + N→N12 (cubre 19-07)
                                type Ext = { lookFor: string; code: string; name: string; hours: number; startTime: string; endTime: string };
                                const D12_PAIRS: Record<string, [Ext, Ext]> = {
                                    N: [
                                        { lookFor: 'T', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                        { lookFor: 'M', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                    ],
                                    M: [
                                        { lookFor: 'T', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                        { lookFor: 'N', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                    ],
                                    T: [
                                        { lookFor: 'M', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                        { lookFor: 'N', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                    ],
                                };
                                const gapKeys = planCoverageModalGaps.map(g => `${g.absentEmpId}_${g.dateStr}`);
                                const n = planCoverageModalGaps.length;
                                const d12Updates: Record<string, any> = {};
                                let d12Count = 0;
                                for (const gap of planCoverageModalGaps) {
                                    const pair = D12_PAIRS[gap.band];
                                    if (!pair) continue;
                                    const gapPosName = gap.positionName || '';
                                    const alreadyChanged = new Set<string>();
                                    for (const ext of pair) {
                                        // Buscar primer compañero del MISMO PUESTO con esa banda, sin contar ya modificados
                                        const emp = planningDotacionEmployees.find((e: any) => {
                                            if (alreadyChanged.has(e.id)) return false;
                                            const key = `${e.id}_${gap.dateStr}`;
                                            const asig = d12Updates[key] ?? pendingChanges[key] ?? shiftsMap[key];
                                            if (asig?.code !== ext.lookFor) return false;
                                            // Verificar que sea del mismo puesto
                                            if (gapPosName) {
                                                const empPos = asig?.positionName || empDefaultPos[`${e.id}___${selectedObjective}`] || '';
                                                if (empPos && empPos !== gapPosName) return false;
                                            }
                                            return true;
                                        }) as any | undefined;
                                        if (emp) {
                                            const key = `${emp.id}_${gap.dateStr}`;
                                            const existing = pendingChanges[key] ?? shiftsMap[key] ?? {};
                                            d12Updates[key] = { ...existing, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective, positionName: gapPosName || existing.positionName, code: ext.code, name: ext.name, hours: ext.hours, startTime: ext.startTime, endTime: ext.endTime, isFranco: false };
                                            alreadyChanged.add(emp.id);
                                            d12Count++;
                                        }
                                    }
                                }
                                // Marcar la celda del ausente con "D12+N12" → visible en "4. CUBIERTO POR"
                                for (const gap of planCoverageModalGaps) {
                                    const absentKey = `${gap.absentEmpId}_${gap.dateStr}`;
                                    const existingAbsent = pendingChanges[absentKey] || shiftsMap[absentKey] || {};
                                    d12Updates[absentKey] = { ...existingAbsent, coveredBy: 'D12+N12 (extensión)' };
                                }
                                if (Object.keys(d12Updates).length > 0) setPendingChanges(prev => ({ ...prev, ...d12Updates }));
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: 'D12', coveredByName: 'D12+N12 (extensión)' }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                // Cada extensión (T→N12 o M→D12) agrega 4h billables (de 8h a 12h)
                                applyCoverageToStats(n, d12Count * 4);
                                toast.success(`D12+N12 aplicado: ${d12Count} turno(s) extendido(s) en ${n} día(s) (+${d12Count * 4}h)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onClose={() => setPlanCoverageModalGaps([])}
                        />
                    );
                })()}

                {recompositionModalOpen && selectedCell?.dateStr && typeof document !== 'undefined' && createPortal(
                    <PlanningRecompositionModal
                        dateStr={selectedCell.dateStr}
                        objectiveId={selectedObjective}
                        objectiveName={getObjectiveName(selectedObjective)}
                        clientId={selectedClient || undefined}
                        employees={planningDotacionEmployees}
                        shiftsMap={shiftsMap}
                        pendingChanges={pendingChanges}
                        absencesMap={absencesMap}
                        preselectedEmpId={selectedCell.empId}
                        preselectedEmployeeName={
                            planningDotacionEmployees.find(e => e.id === selectedCell.empId)?.name
                            || displayedEmployees.find((e: { id: string; name?: string }) => e.id === selectedCell.empId)?.name
                        }
                        onApply={applyRecompositionPackage}
                        onRequestSupervisorAuth={(conflicts, onAuthorized) => {
                            requestSupervisorFrancoAuth(conflicts, onAuthorized, 'cobertura / liberación');
                        }}
                        onClose={() => setRecompositionModalOpen(false)}
                        currentObjectiveLat={Number(selectedObjectiveData?.lat ?? selectedObjectiveData?.latitude ?? 0) || null}
                        currentObjectiveLng={Number(selectedObjectiveData?.lng ?? selectedObjectiveData?.longitude ?? 0) || null}
                        allObjectives={clients.flatMap((c: any) =>
                            (c.objetivos || []).map((o: any) => ({
                                id: o.id || o.name,
                                name: o.name || o.id || '',
                                lat: Number(o.lat ?? o.latitude ?? 0) || null,
                                lng: Number(o.lng ?? o.longitude ?? 0) || null,
                                clientName: c.name || c.razonSocial || c.businessName || '',
                            }))
                        ).filter((o: any) => o.id)}
                        allEmployees={employees}
                    />,
                    document.body,
                )}

                {showCronogramasOverview && typeof document !== 'undefined' && createPortal(
                    <PlanningCronogramasOverviewModal
                        isOpen={showCronogramasOverview}
                        onClose={() => setShowCronogramasOverview(false)}
                        year={currentDate.getFullYear()}
                        month={currentDate.getMonth() + 1}
                        onMonthChange={(y, m) => { if (goToPlanningMonth(y, m - 1)) setAutoGeneratedReady(false); }}
                        empresaId={empresaId || ''}
                        migracionCompleta={migracionCompleta}
                        scopeEmpresa={scopeEmpresa}
                        clients={clients}
                        onNavigateToObjective={navigateToObjectiveFromOverview}
                    />,
                    document.body,
                )}

                {/* ── Modal verificación de cobertura post-generación ── */}
                {showCoverageModal && autoV2Coverage && (
                    <PlanningCoverageVerificationModal
                        coverage={autoV2Coverage}
                        suggestions={autoV2Suggestions}
                        displayedEmployees={displayedEmployees}
                        onClose={() => setShowCoverageModal(false)}
                    />
                )}

                {/* ── Modal automatizar cronograma (motor COSP) ── */}
                {showAutoV2Modal && (
                    <PlanningAutoScheduleModal
                        autoV2Loading={autoV2Loading}
                        autoV2Generating={autoV2Generating}
                        autoV2GeminiLoading={autoV2GeminiLoading}
                        autoWizardStep={autoWizardStep}
                        autoV2CoveragePreflight={autoV2CoveragePreflight}
                        autoV2BudgetMode={autoV2BudgetMode}
                        setAutoV2BudgetMode={setAutoV2BudgetMode}
                        setAutoHelpTopic={setAutoHelpTopic}
                        autoOverwrite={autoOverwrite}
                        setAutoOverwrite={setAutoOverwrite}
                        autoCoverAbsences={autoCoverAbsences}
                        setAutoCoverAbsences={setAutoCoverAbsences}
                        autoRotateForce={autoRotateForce}
                        setAutoRotateForce={setAutoRotateForce}
                        autoPlanningBrainReport={autoPlanningBrainReport}
                        useSixPlusOne={useSixPlusOne}
                        setUseSixPlusOne={setUseSixPlusOne}
                        planningDotacionEmployees={planningDotacionEmployees}
                        daysInMonth={daysInMonth}
                        autoContingenciaDias={autoContingenciaDias}
                        setAutoContingenciaDias={setAutoContingenciaDias}
                        autoAbsencesMap={autoAbsencesMap}
                        autoAjustarCrono={autoAjustarCrono}
                        setAutoAjustarCrono={setAutoAjustarCrono}
                        autoV2RunGemini={autoV2RunGemini}
                        setAutoV2RunGemini={setAutoV2RunGemini}
                        autoHelpTopic={autoHelpTopic}
                        displayedEmployees={displayedEmployees}
                        handleUnassignEmployee={handleUnassignEmployee}
                        setAutoWizardStep={setAutoWizardStep}
                        employees={employees}
                        selectedObjective={selectedObjective}
                        autoPlanningBrainInputRef={autoPlanningBrainInputRef}
                        autoPlanningBrainRef={autoPlanningBrainRef}
                        setAutoPlanningBrainReport={setAutoPlanningBrainReport}
                        setAutoCycles={setAutoCycles}
                        autoSelectedCyclesRef={autoSelectedCyclesRef}
                        objectiveServiceAnalysis={objectiveServiceAnalysis}
                        autoV2Report={autoV2Report}
                        autoV2Progress={autoV2Progress}
                        autoV2GenStats={autoV2GenStats}
                        autoCycles={autoCycles}
                        slaVendidas={slaVendidas}
                        autoCoverageGaps={autoCoverageGaps}
                        coverageSelectedDays={coverageSelectedDays}
                        setCoverageSelectedDays={setCoverageSelectedDays}
                        setPendingChanges={setPendingChanges}
                        setAutoCoverageGaps={setAutoCoverageGaps}
                        setPlanCoverageModalGaps={setPlanCoverageModalGaps}
                        positionStructure={positionStructure}
                        autoV2FormReport={autoV2FormReport}
                        rebalanceAutoForm={rebalanceAutoForm}
                        autoV2Rebalancing={autoV2Rebalancing}
                        autoV2RebalanceLog={autoV2RebalanceLog}
                        autoV2TrailDiag={autoV2TrailDiag}
                        autoV2ShowTrailDiag={autoV2ShowTrailDiag}
                        setAutoV2ShowTrailDiag={setAutoV2ShowTrailDiag}
                        capOverflowEmps={capOverflowEmps}
                        over200AuthChecked={over200AuthChecked}
                        setOver200AuthChecked={setOver200AuthChecked}
                        over200AuthPin={over200AuthPin}
                        setOver200AuthPin={setOver200AuthPin}
                        over200AuthError={over200AuthError}
                        setOver200AuthError={setOver200AuthError}
                        authorizedOver200Ids={authorizedOver200Ids}
                        setAuthorizedOver200Ids={setAuthorizedOver200Ids}
                        authorizedOver200IdsRef={authorizedOver200IdsRef}
                        setCapOverflowEmps={setCapOverflowEmps}
                        applyAutoScheduleV2={applyAutoScheduleV2}
                        autoWizardPersonalize={autoWizardPersonalize}
                        setAutoWizardPersonalize={setAutoWizardPersonalize}
                        runFullGeneration={runFullGeneration}
                        runAutoV2PlanningAgentGemini={runAutoV2PlanningAgentGemini}
                        autoV2LastRun={autoV2LastRun}
                        autoV2Coverage={autoV2Coverage}
                        pendingChanges={pendingChanges}
                        setAutoV2Coverage={setAutoV2Coverage}
                        setAutoV2LastRun={setAutoV2LastRun}
                        setAutoV2Suggestions={setAutoV2Suggestions}
                        slaDebug={slaDebug}
                        setSlaDebug={setSlaDebug}
                        fetchSlaDebug={fetchSlaDebug}
                        slaDebugLoading={slaDebugLoading}
                        setAutoV2GeminiLoading={setAutoV2GeminiLoading}
                        setAutoV2Progress={setAutoV2Progress}
                        autoV2GeminiSummary={autoV2GeminiSummary}
                        setShowAutoV2Modal={setShowAutoV2Modal}
                    />
                )}

            {showDiagnostic && diagnosticPanelPos && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowDiagnostic(false)} />
                    <div
                        className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-2xl min-w-[280px] max-w-[min(420px,calc(100vw-2rem))] p-3 animate-in zoom-in-95 max-h-[min(70vh,520px)] overflow-y-auto custom-scrollbar"
                        style={{ left: diagnosticPanelPos.x, top: diagnosticPanelPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Estructura del Servicio</p>
                        {objectiveServiceAnalysis && (
                            <div className="mb-3">
                                <ObjectiveServiceAnalysisCard analysis={objectiveServiceAnalysis} compact />
                            </div>
                        )}
                        <div className="space-y-1.5">
                            {(selectedGrupo && grupoUnifiedMode && Object.keys(grupoSlaMap).length > 0)
                                ? selectedGrupo.objectiveIds.map((objId: string, oi: number) => {
                                    const struct = grupoSlaMap[objId] || [];
                                    const clr = GRUPO_COLOR_HEX[oi % GRUPO_COLOR_HEX.length];
                                    const nm = selectedGrupo.objectiveNames[oi] || objId;
                                    return (
                                        <div key={objId} className="mb-2">
                                            <div className="flex items-center gap-1.5 mb-1 px-0.5">
                                                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: clr }}/>
                                                <span className="text-[9px] font-black uppercase truncate" style={{ color: clr }}>{nm}</span>
                                            </div>
                                            {struct.map((pos: any, i: number) => (
                                                <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg mb-1">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                                                            <span>{pos.positionName}</span>
                                                            {renderPositionGeneroBadge(pos.preferenciaGenero)}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                                            {(pos.shifts || []).map((sh: any, j: number) => (
                                                                <span key={j} className="text-[9px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-700 font-bold">
                                                                    {sh.code || sh.name}{sh.hours ? ` · ${sh.hours}h` : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded shrink-0">{pos.qty} pax</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })
                                : positionStructure.map((pos, i) => (
                                    <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                                                <span>{pos.positionName}</span>
                                                {renderPositionGeneroBadge(pos.preferenciaGenero)}
                                            </p>
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                                {(pos.shifts || []).map((sh: any, j: number) => (
                                                    <span key={j} className="text-[9px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-700 font-bold">
                                                        {sh.code || sh.name}{sh.hours ? ` · ${sh.hours}h` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded shrink-0">{pos.qty} pax</span>
                                    </div>
                                ))
                            }
                        </div>
                        {(selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0 ? grupoTotalVendidas : slaVendidas) > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between items-center">
                                <span className="text-[9px] font-black text-slate-400 uppercase">Hs. Vendidas / mes</span>
                                <span className="text-base font-black text-teal-600">{selectedGrupo && grupoUnifiedMode && grupoTotalVendidas > 0 ? grupoTotalVendidas : slaVendidas}h</span>
                            </div>
                        )}
                    </div>
                </>,
                document.body,
            )}

            {showCoverageDiagnostic && coveragePanelPos && (selectedGrupo && grupoUnifiedMode ? grupoGapReport : objectiveCoverageGapReport) && typeof document !== 'undefined' && createPortal(
                (() => {
                    const _rpt = (selectedGrupo && grupoUnifiedMode ? grupoGapReport : objectiveCoverageGapReport)!;
                    const _isGroup = !!(selectedGrupo && grupoUnifiedMode);
                    return (
                <>
                    <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowCoverageDiagnostic(false)} />
                    <div
                        className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-2xl min-w-[320px] max-w-[min(420px,calc(100vw-2rem))] p-3 animate-in zoom-in-95 max-h-[min(70vh,520px)] overflow-y-auto custom-scrollbar"
                        style={{ left: coveragePanelPos.x, top: coveragePanelPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Qué falta para cerrar el SLA</p>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="bg-emerald-50 rounded-lg p-2 text-center border border-emerald-100">
                                <div className="text-lg font-black text-emerald-700">{_rpt.daysFull}</div>
                                <div className="text-[8px] font-bold text-emerald-600 uppercase">Días 100%</div>
                            </div>
                            <div className="bg-amber-50 rounded-lg p-2 text-center border border-amber-100">
                                <div className="text-lg font-black text-amber-700">{_rpt.daysPartial}</div>
                                <div className="text-[8px] font-bold text-amber-600 uppercase">Parcial</div>
                            </div>
                            <div className="bg-rose-50 rounded-lg p-2 text-center border border-rose-100">
                                <div className="text-lg font-black text-rose-700">{_rpt.daysEmpty}</div>
                                <div className="text-[8px] font-bold text-rose-600 uppercase">Sin cerrar</div>
                            </div>
                        </div>
                        {!_isGroup && (objectiveCoverageGapReport as any)?.aggregateMissingPrimary && Object.keys((objectiveCoverageGapReport as any).aggregateMissingPrimary).length > 0 && (
                            <div className="mb-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Bandas faltantes en el mes (esquema M+T+N)</p>
                                <div className="flex flex-wrap gap-1">
                                    {Object.entries((objectiveCoverageGapReport as any).aggregateMissingPrimary)
                                        .sort((a: any, b: any) => b[1] - a[1])
                                        .map(([code, n]: any) => (
                                            <span key={code} className="text-[9px] font-black bg-rose-100 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
                                                {n}x{code}
                                            </span>
                                        ))}
                                </div>
                            </div>
                        )}
                        {_rpt.worstDays.length > 0 && (
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Días con huecos</p>
                                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                                    {_rpt.worstDays.slice(0, 8).map((wd: any) => {
                                        const dayGaps = !_isGroup ? ((objectiveCoverageGapReport as any)?.byDay?.[wd.dateStr]?.positions || []) : [];
                                        return (
                                            <div key={wd.dateStr} className="p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                <div className="flex justify-between text-[10px] font-black text-slate-700 dark:text-slate-200 mb-0.5">
                                                    <span>Día {wd.dateStr.slice(8)}</span>
                                                    <span className="text-rose-600">{_isGroup ? `${wd.closedPax}/${wd.requiredPax}` : `${wd.closed}/${wd.required}`}</span>
                                                </div>
                                                {dayGaps.slice(0, 3).map((g: any, i: number) => (
                                                    <p key={i} className="text-[9px] text-slate-500 leading-snug">{g.positionName}: {g.summary}</p>
                                                ))}
                                                {dayGaps.length > 3 && (
                                                    <p className="text-[8px] text-slate-400">+{dayGaps.length - 3} puestos más</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </>
                    );
                })(),
                document.body,
            )}
            {/* ── Modal asignar guardia a RFZ vacante ── */}
            {rfzAsignando && (
                <div className="fixed inset-0 bg-black/60 z-[75] flex items-center justify-center p-4"
                    onClick={() => setRfzAsignando(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-start gap-3">
                            <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">RFZ</span>
                            <div>
                                <h2 className="font-black text-slate-800 text-base leading-tight">Asignar guardia al refuerzo</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {rfzAsignando.positionName || 'Sin puesto'} · {formatTime(rfzAsignando.startTime)}–{formatTime(rfzAsignando.endTime)} · {rfzAsignando.fecha}
                                </p>
                                {rfzAsignando.solicitadoPorNombre && (
                                    <p className="text-[10px] text-red-500 font-bold mt-0.5">
                                        Solicitado por: {rfzAsignando.solicitadoPorNombre}
                                    </p>
                                )}
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold -mt-1">
                            Solo guardias disponibles ese día (sin turno, RET o franco). Se prioriza titular y quien conoce el objetivo.
                        </p>
                        <div className="flex flex-col max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {(() => {
                                const fecha = rfzAsignando.fecha;
                                const objId = rfzAsignando.objectiveId;
                                const cliId = rfzAsignando.clientId;
                                const categorizar = (emp: any) => {
                                    const key = `${emp.id}_${fecha}`;
                                    const pend = pendingChanges[key];
                                    const shift = pend ? (pend.isDeleted ? null : pend) : shiftsMap[key];
                                    const code = String(shift?.code || '').toUpperCase();
                                    if (!shift || !code) return { rank: 0, label: 'Sin turno', cls: 'bg-emerald-100 text-emerald-700', franco: false };
                                    if (code === 'RET') return { rank: 1, label: 'RET (stand-by)', cls: 'bg-sky-100 text-sky-700', franco: false };
                                    if (['F', 'FF', 'FP'].includes(code)) return { rank: 2, label: 'De franco → FT', cls: 'bg-amber-100 text-amber-700', franco: true };
                                    return null;
                                };
                                // Experiencia (igual que Operaciones): 3 titular, 2 conoce objetivo, 1 mismo cliente.
                                const expLevel = (emp: any): number => {
                                    if (objId && emp.preferredObjectiveId === objId) return 3;
                                    const expMap: Record<string, any> = emp.experienciaObjetivos || {};
                                    const entry = objId ? expMap[objId] : null;
                                    if (entry) {
                                        const total = (entry.turnosRegulares ?? 0) + (entry.turnosRefuerzo ?? 0) + (entry.turnosConvocado ?? 0) + (entry.turnosEscuela ?? 0);
                                        if (total > 0) return 2;
                                    }
                                    if (cliId && emp.clientId === cliId) return 1;
                                    return 0;
                                };
                                const expBadge = (lv: number) =>
                                    lv === 3 ? { label: '★ Titular', cls: 'bg-emerald-100 text-emerald-700' }
                                  : lv === 2 ? { label: '◆ Conoce el objetivo', cls: 'bg-blue-50 text-blue-600' }
                                  : lv === 1 ? { label: 'Mismo cliente', cls: 'bg-slate-100 text-slate-500' }
                                  : null;
                                const candidatos = (displayedEmployees as any[])
                                    .map(emp => ({ emp, cat: categorizar(emp), exp: expLevel(emp) }))
                                    .filter((x): x is { emp: any; cat: NonNullable<ReturnType<typeof categorizar>>; exp: number } => x.cat !== null)
                                    .sort((a, b) => (a.cat.rank - b.cat.rank) || (b.exp - a.exp) || String(a.emp.name).localeCompare(String(b.emp.name)));
                                if (candidatos.length === 0) {
                                    return <p className="text-xs text-slate-400 text-center py-4">No hay guardias disponibles (sin turno, RET o franco) ese día</p>;
                                }
                                return candidatos.map(({ emp, cat, exp }) => {
                                    const eb = expBadge(exp);
                                    return (
                                        <button key={emp.id}
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await updateDoc(doc(db, 'turnos', rfzAsignando.id), {
                                                        employeeId: emp.id,
                                                        employeeName: emp.name,
                                                        ...(cat.franco ? { isFrancoTrabajado: true, coveredFromFranco: true } : {}),
                                                    });
                                                    const solId = String(rfzAsignando.solicitudRefuerzoId || '').trim();
                                                    if (solId) {
                                                        try {
                                                            const solSnap = await getDoc(doc(db, 'solicitudes_refuerzo', solId));
                                                            if (solSnap.exists()) {
                                                                const solData = solSnap.data();
                                                                const prevIds = Array.isArray(solData.empleadoIds) ? solData.empleadoIds : [];
                                                                const prevNames = Array.isArray(solData.empleadoNames) ? solData.empleadoNames : [];
                                                                await solicitudRefuerzoService.update(solId, {
                                                                    estado: 'ASIGNADA',
                                                                    empleadoIds: prevIds.includes(emp.id) ? prevIds : [...prevIds, emp.id],
                                                                    empleadoNames: prevIds.includes(emp.id) ? prevNames : [...prevNames, emp.name],
                                                                });
                                                            }
                                                        } catch { /* turno asignado; sync solicitud best-effort */ }
                                                    }
                                                    activateRfzCorrectionFlow();
                                                    setRfzAsignando(null);
                                                    const lookupKey = planificacionPublishLookupKey(
                                                        selectedObjective,
                                                        currentDate.getFullYear(),
                                                        currentDate.getMonth() + 1,
                                                    );
                                                    const yaPublicado = isPlanificacionPublished(publishStatusMap[lookupKey]);
                                                    toast.success(
                                                        yaPublicado
                                                            ? (cat.franco
                                                                ? `${emp.name} asignado/a al RFZ (Franco Trabajado). Modo corrección activo — re-publicá para notificarle.`
                                                                : `${emp.name} asignado/a al RFZ. Modo corrección activo — re-publicá para notificarle.`)
                                                            : (cat.franco
                                                                ? `${emp.name} asignado/a al RFZ (Franco Trabajado). Publicá el cronograma para notificarle.`
                                                                : `${emp.name} asignado/a al RFZ. Publicá el cronograma para notificarle.`),
                                                    );
                                                } catch {
                                                    toast.error('Error al asignar guardia');
                                                }
                                            }}
                                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-left transition-colors">
                                            <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600 shrink-0">
                                                {(emp.name || '?')[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-sm text-slate-700 font-semibold truncate">{emp.name}</span>
                                                {eb && (
                                                    <span className={`inline-block mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${eb.cls}`}>{eb.label}</span>
                                                )}
                                            </div>
                                            <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${cat.cls}`}>{cat.label}</span>
                                        </button>
                                    );
                                });
                            })()}
                        </div>
                        <button type="button" onClick={() => setRfzAsignando(null)}
                            className="self-end text-xs text-slate-400 hover:text-slate-600">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
            </div>

            {/* ── MODAL AJUSTAR CRONO ── */}
            <AjustarCronoOperativoModal
                open={showAjustarCronoModal}
                onClose={() => setShowAjustarCronoModal(false)}
                empresaId={empresaId || ''}
                fechaInicial={currentDate}
                fechaHastaInicial={currentDate}
                objetivoInicial={selectedObjectiveData ? { id: selectedObjectiveData.id, nombre: selectedObjectiveData.nombre || selectedObjectiveData.name || '' } : undefined}
                clients={clients}
                gridSnapshot={{ shiftsMap, pendingChanges }}
            />

            {/* ── MODAL EQUILIBRAR CRONO ── */}
            <EquilibrarCronoModal
                open={showEquilibrarModal}
                onClose={() => setShowEquilibrarModal(false)}
                empresaId={empresaId || ''}
                objectiveId={selectedObjective || ''}
                objectiveNombre={selectedObjectiveData?.nombre || selectedObjectiveData?.name || selectedObjective || ''}
                year={currentDate.getFullYear()}
                month={currentDate.getMonth() + 1}
                employees={planningDotacionEmployees}
                cctMaxBillableHours={planningLimits.monthly}
                onApplyPending={(changes) => {
                    const newPending: Record<string, any> = { ...pendingChanges };
                    for (const c of changes) {
                        newPending[`${c.empId}_${c.dateStr}`] = {
                            code:         c.code,
                            name:         c.name,
                            hours:        c.hours,
                            positionName: c.positionName,
                            startTime:    c.startTimeStr,
                            endTime:      c.endTimeStr,
                            isFranco:     false,
                            isTemp:       true,
                            swapWith:     null,
                            swapDate:     null,
                            comments:     'Equilibrar horas',
                        };
                    }
                    setPendingChanges(newPending);
                }}
            />
        {/* MODAL: Crear / Editar grupo de objetivos */}
        {showGrupoForm && (
            <PlanningGroupFormModal
                mode={grupoFormMode}
                name={grupoFormNombre}
                clientId={grupoFormClientId}
                objectiveIds={grupoFormObjectiveIds}
                clients={clients}
                saving={savingGrupo}
                onClose={() => setShowGrupoForm(false)}
                onNameChange={setGrupoFormNombre}
                onClientChange={(clientId) => {
                    setGrupoFormClientId(clientId);
                    setGrupoFormObjectiveIds([]);
                }}
                onToggleObjective={(objectiveId) => setGrupoFormObjectiveIds((previous) =>
                    previous.includes(objectiveId)
                        ? previous.filter((id) => id !== objectiveId)
                        : [...previous, objectiveId]
                )}
                onSave={handleSaveGrupo}
            />
        )}
        {/* MODAL CREAR EVENTO */}
        {showEventoCreateModal && (
            <div className="fixed inset-0 z-[9100] bg-slate-900/60 flex items-center justify-center p-4" onClick={() => setShowEventoCreateModal(false)}>
                <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                    <div className="p-5 border-b bg-yellow-50 flex items-center gap-3">
                        <div className="p-2 bg-yellow-400 rounded-xl"><Calendar size={18} className="text-yellow-900"/></div>
                        <div>
                            <h3 className="font-black text-base text-slate-900 uppercase">Nuevo Evento</h3>
                            <p className="text-[11px] text-yellow-700 font-bold mt-0.5">Servicio especial / evento puntual</p>
                        </div>
                        <button className="ml-auto p-1.5 hover:bg-yellow-100 rounded-lg" onClick={() => setShowEventoCreateModal(false)}><X size={16}/></button>
                    </div>
                    <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Nombre del evento *</label>
                            <input
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                placeholder="Ej: Recital Bad Bunny, Partido Talleres vs Racing..."
                                value={eventoForm.nombre || ''}
                                onChange={e => setEventoForm(p => ({ ...p, nombre: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Cliente *</label>
                            <input
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                placeholder="Nombre del cliente"
                                value={eventoForm.clienteNombre || ''}
                                onChange={e => setEventoForm(p => ({ ...p, clienteNombre: e.target.value, clienteId: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Fecha principal *</label>
                            <input
                                type="date"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                value={eventoForm.fecha || ''}
                                onChange={e => setEventoForm(p => ({ ...p, fecha: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Fechas adicionales (separadas por coma)</label>
                            <input
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                placeholder="Ej: 2026-08-20, 2026-08-21"
                                value={(eventoForm.fechas || []).join(', ')}
                                onChange={e => {
                                    const vals = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                    setEventoForm(p => ({ ...p, fechas: vals }));
                                }}
                            />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Desde</label>
                                <input
                                    type="time"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    value={eventoForm.horaInicio || '08:00'}
                                    onChange={e => {
                                        const hi = e.target.value;
                                        const horas = calcHorasEvento(hi, eventoForm.horaFin || '20:00');
                                        setEventoForm(p => ({ ...p, horaInicio: hi, horasEvento: horas }));
                                    }}
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Hasta</label>
                                <input
                                    type="time"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    value={eventoForm.horaFin || '20:00'}
                                    onChange={e => {
                                        const hf = e.target.value;
                                        const horas = calcHorasEvento(eventoForm.horaInicio || '08:00', hf);
                                        setEventoForm(p => ({ ...p, horaFin: hf, horasEvento: horas }));
                                    }}
                                />
                            </div>
                            <div className="w-20">
                                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Horas</label>
                                <div className="border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-black text-center text-yellow-800">
                                    {eventoForm.horasEvento ?? calcHorasEvento(eventoForm.horaInicio || '08:00', eventoForm.horaFin || '20:00')}h
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Cupo de guardias</label>
                            <input
                                type="number"
                                min={1}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                value={eventoForm.cupoGuardias ?? 5}
                                onChange={e => setEventoForm(p => ({ ...p, cupoGuardias: parseInt(e.target.value) || 1 }))}
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Descripción (opcional)</label>
                            <textarea
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                rows={2}
                                placeholder="Detalles adicionales del evento..."
                                value={eventoForm.descripcion || ''}
                                onChange={e => setEventoForm(p => ({ ...p, descripcion: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
                        <button onClick={() => setShowEventoCreateModal(false)} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100">Cancelar</button>
                        <button
                            disabled={eventoFormSaving || !eventoForm.nombre?.trim() || !eventoForm.clienteNombre?.trim() || !eventoForm.fecha}
                            onClick={async () => {
                                if (!eventoForm.nombre?.trim() || !eventoForm.fecha || !empresaId) return;
                                setEventoFormSaving(true);
                                try {
                                    const horas = calcHorasEvento(eventoForm.horaInicio || '08:00', eventoForm.horaFin || '20:00');
                                    const newEvento: Omit<Evento, 'id'> = {
                                        empresaId,
                                        nombre: eventoForm.nombre.trim(),
                                        descripcion: eventoForm.descripcion?.trim() || '',
                                        clienteId: eventoForm.clienteId || eventoForm.clienteNombre!.toLowerCase().replace(/\s+/g, '_'),
                                        clienteNombre: eventoForm.clienteNombre!.trim(),
                                        fecha: eventoForm.fecha!,
                                        fechas: eventoForm.fechas?.filter(Boolean) || [],
                                        horaInicio: eventoForm.horaInicio || '08:00',
                                        horaFin: eventoForm.horaFin || '20:00',
                                        horasEvento: horas,
                                        cupoGuardias: eventoForm.cupoGuardias || 1,
                                        status: 'activo',
                                        creadoPor: activeActorName || 'Sistema',
                                    };
                                    await eventoService.add(newEvento);
                                    // Refrescar lista de eventos del mes
                                    const yr = currentDate.getFullYear();
                                    const mo = currentDate.getMonth() + 1;
                                    const fromDate = `${yr}-${String(mo).padStart(2, '0')}-01`;
                                    const lastDay = new Date(yr, mo, 0).getDate();
                                    const toDate = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
                                    const refreshed = await eventoService.getByEmpresaAndRange(empresaId, fromDate, toDate);
                                    setEventos(refreshed);
                                    setShowEventoCreateModal(false);
                                    toast.success(`Evento "${newEvento.nombre}" creado`);
                                } catch (err) {
                                    console.error(err);
                                    toast.error('Error al crear el evento');
                                } finally {
                                    setEventoFormSaving(false);
                                }
                            }}
                            className="px-5 py-2 rounded-lg text-sm font-black bg-yellow-400 text-yellow-900 hover:bg-yellow-500 disabled:opacity-40 flex items-center gap-2"
                        >
                            {eventoFormSaving ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>}
                            Crear evento
                        </button>
                    </div>
                </div>
            </div>
        )}
        </DashboardLayout>
    );
}

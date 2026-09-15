import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import type { PendingAbsenceNovedad, RecompositionPackage } from '@/lib/planificacion/planningRecomposition.types';

export type ApplyPlanificacionRecompositionPackageParams = {
    updates: Record<string, any>;
    pkg: RecompositionPackage;
    novedad?: PendingAbsenceNovedad;
    setPendingChanges: Dispatch<SetStateAction<Record<string, any>>>;
    setPendingNovedades: Dispatch<SetStateAction<Record<string, PendingAbsenceNovedad>>>;
    setPendingRecompositionPackages: Dispatch<SetStateAction<RecompositionPackage[]>>;
    setSelectedCell: (value: null) => void;
    setRecompositionModalOpen: (value: boolean) => void;
};

export function applyPlanificacionRecompositionPackage({
    updates,
    pkg,
    novedad,
    setPendingChanges,
    setPendingNovedades,
    setPendingRecompositionPackages,
    setSelectedCell,
    setRecompositionModalOpen,
}: ApplyPlanificacionRecompositionPackageParams): void {
    setPendingChanges(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(updates)) {
            next[k] = { ...v, isTemp: true };
        }
        return next;
    });
    if (novedad) {
        const key = `${novedad.employeeId}_${novedad.startDate}`;
        setPendingNovedades(prev => ({ ...prev, [key]: novedad }));
    }
    setPendingRecompositionPackages(prev => [...prev.filter(p => p.id !== pkg.id), pkg]);
    setSelectedCell(null);
    setRecompositionModalOpen(false);
    toast.success(
        novedad?.absenceType === 'RA' || novedad?.type === 'Retiro anticipado'
            ? 'Retiro anticipado y cobertura aplicados (pendiente de guardar)'
            : novedad
                ? 'Novedad RRHH y cobertura aplicadas (pendiente de guardar)'
                : 'Paquete cobertura/liberación aplicado (pendiente de guardar)',
    );
}

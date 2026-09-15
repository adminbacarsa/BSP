import { doc, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import type { PlanificacionConflictNeighbors } from '@/lib/planificacion/findPlanificacionConflictNeighbors';

export type ResolvePlanificacionConflictType = 'SPLIT' | 'FULL_COVERAGE';

export type ResolvePlanificacionConflictParams = {
    type: ResolvePlanificacionConflictType;
    selectedCell: {
        currentShift?: { id: string } | null;
        absence?: unknown;
    } | null;
    conflictNeighbors: PlanificacionConflictNeighbors | null;
    setShowConflictModal: (value: boolean) => void;
    setFrancoMode: (mode: string) => void;
    setSelectedCell: (value: null) => void;
};

export async function resolvePlanificacionConflict({
    type,
    selectedCell,
    conflictNeighbors,
    setShowConflictModal,
    setFrancoMode,
    setSelectedCell,
}: ResolvePlanificacionConflictParams): Promise<void> {
    if (!selectedCell?.currentShift) return;
    const batch = writeBatch(db);
    const shiftId = selectedCell.currentShift.id;
    if (selectedCell.absence) {
        batch.update(doc(db, 'turnos', shiftId), { status: 'ABSENT', comments: 'Cubierto por ausencia' });
    } else {
        batch.update(doc(db, 'turnos', shiftId), { hasNovedad: false, comments: 'Novedad resuelta' });
    }
    if (type === 'SPLIT') {
        if (conflictNeighbors?.prev) {
            batch.update(doc(db, 'turnos', conflictNeighbors.prev.id), { isExtended: true, comments: 'Extensión por cobertura' });
        }
        if (conflictNeighbors?.next) {
            batch.update(doc(db, 'turnos', conflictNeighbors.next.id), { isEarlyStart: true, comments: 'Adelanto por cobertura' });
        }
        toast.success('Cobertura aplicada: Extensión + Adelanto');
    } else {
        setShowConflictModal(false);
        setFrancoMode('FT_SELECTION');
        return;
    }
    await batch.commit();
    setShowConflictModal(false);
    setSelectedCell(null);
}

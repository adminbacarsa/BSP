import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ServicePosition, ShiftVariant } from '@/services/slaService';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';

export type ApplySlaRefuerzoResult = {
    slaId: string;
    positionName: string;
    shiftCode: string;
    addedPax: number;
};

function norm(s: string | undefined | null): string {
    return String(s || '').trim().toLowerCase();
}

function matchPosition(positions: ServicePosition[], sol: SolicitudRefuerzo): ServicePosition | undefined {
    const byId = sol.positionId
        ? positions.find((p) => p.id === sol.positionId || norm(p.name) === norm(sol.positionId))
        : undefined;
    if (byId) return byId;
    if (sol.positionName) {
        return positions.find((p) => norm(p.name) === norm(sol.positionName));
    }
    return undefined;
}

function matchShift(pos: ServicePosition, sol: SolicitudRefuerzo): ShiftVariant | undefined {
    const code = String(sol.shiftCode || '').toUpperCase();
    const shifts = pos.allowedShiftTypes || [];
    if (code) {
        const hit = shifts.find((s) => String(s.code || '').toUpperCase() === code);
        if (hit) return hit;
    }
    const start = String(sol.startTime || '').slice(0, 5);
    const end = String(sol.endTime || '').slice(0, 5);
    if (start && end) {
        return shifts.find((s) => String(s.startTime || '').slice(0, 5) === start && String(s.endTime || '').slice(0, 5) === end);
    }
    return shifts[0];
}

/** Suma pax al puesto/turno del SLA vigente del objetivo (refuerzo estructural). */
export async function applySlaRefuerzoPax(sol: SolicitudRefuerzo): Promise<ApplySlaRefuerzoResult> {
    const addedPax = Math.max(1, Math.floor(Number(sol.cantidadPax) || 1));
    if (!sol.objectiveId) throw new Error('La solicitud no tiene objetivo');

    const { getDocs, query, collection, where } = await import('firebase/firestore');
    const snap = await getDocs(query(
        collection(db, 'servicios_sla'),
        where('objectiveId', '==', sol.objectiveId),
        where('status', '==', 'active'),
    ));
    if (snap.empty) throw new Error('No hay SLA activo para este objetivo');

    let best = snap.docs[0];
    snap.docs.forEach((d) => {
        const a = (best.data().positions || []).length;
        const b = (d.data().positions || []).length;
        if (b > a) best = d;
    });

    const slaRef = doc(db, 'servicios_sla', best.id);
    const fresh = await getDoc(slaRef);
    if (!fresh.exists()) throw new Error('SLA no encontrado');
    const positions: ServicePosition[] = [...(fresh.data().positions || [])];
    const pos = matchPosition(positions, sol);
    if (!pos) throw new Error('No se encontró el puesto del SLA para aplicar el refuerzo');

    const shift = matchShift(pos, sol);
    const posIdx = positions.indexOf(pos);
    const nextPos: ServicePosition = { ...pos, allowedShiftTypes: [...(pos.allowedShiftTypes || [])] };

    if (shift) {
        const shIdx = nextPos.allowedShiftTypes.findIndex((s) => s === shift || (
            String(s.code || '').toUpperCase() === String(shift.code || '').toUpperCase()
            && String(s.startTime || '') === String(shift.startTime || '')
        ));
        if (shIdx >= 0) {
            const cur = nextPos.allowedShiftTypes[shIdx];
            const base = cur.quantity != null ? Number(cur.quantity) : Number(nextPos.quantity || 1);
            nextPos.allowedShiftTypes[shIdx] = { ...cur, quantity: Math.max(1, base) + addedPax };
        } else {
            nextPos.quantity = Math.max(1, Number(nextPos.quantity || 1)) + addedPax;
        }
    } else {
        nextPos.quantity = Math.max(1, Number(nextPos.quantity || 1)) + addedPax;
    }

    positions[posIdx] = nextPos;
    await updateDoc(slaRef, {
        positions,
        updatedAt: Timestamp.now(),
        lastRefuerzoSolicitudId: sol.id || null,
    });

    return {
        slaId: best.id,
        positionName: nextPos.name,
        shiftCode: String(shift?.code || sol.shiftCode || ''),
        addedPax,
    };
}

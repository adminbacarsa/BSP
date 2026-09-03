import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  appendSlaChangeLog,
  type ServicePosition,
  type ShiftVariant,
  type SlaChangeLogEntry,
} from '@/services/slaService';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';
import {
  appendPaxBoostRange,
  normalizeYmd,
  removePaxBoostBySolicitudId,
} from '@/lib/servicios/paxBoostRanges';

export type ApplySlaRefuerzoResult = {
    slaId: string;
    positionName: string;
    shiftCode: string;
    addedPax: number;
    positionId?: string;
};

export type SlaActor = { uid?: string; name?: string };

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
    const code = String(sol.shiftCode || sol.slaAppliedShiftCode || '').toUpperCase();
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

async function resolveSlaRef(sol: SolicitudRefuerzo) {
    if (sol.slaIdAplicado) {
        const slaRef = doc(db, 'servicios_sla', sol.slaIdAplicado);
        const fresh = await getDoc(slaRef);
        if (fresh.exists()) return { slaRef, fresh };
    }
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
    return { slaRef, fresh };
}

function applyPaxDelta(pos: ServicePosition, sol: SolicitudRefuerzo, delta: number): { next: ServicePosition; shiftCode: string } {
    const explicitBand = String(sol.shiftCode || sol.slaAppliedShiftCode || '').trim().toUpperCase();
    const nextPos: ServicePosition = { ...pos, allowedShiftTypes: [...(pos.allowedShiftTypes || [])] };
    const posBase = Number(nextPos.quantity || 1);

    /** Sin banda explícita = rotación del puesto completo (+pax en todas las bandas). */
    if (!explicitBand) {
        nextPos.quantity = Math.max(0, posBase + delta);
        nextPos.allowedShiftTypes = nextPos.allowedShiftTypes.map((s) => {
            const base = s.quantity != null ? Number(s.quantity) : posBase;
            return { ...s, quantity: Math.max(0, base + delta) };
        });
        return { next: nextPos, shiftCode: '' };
    }

    const shift = matchShift(pos, sol);

    if (shift) {
        const shIdx = nextPos.allowedShiftTypes.findIndex((s) => s === shift || (
            String(s.code || '').toUpperCase() === String(shift.code || '').toUpperCase()
            && String(s.startTime || '') === String(shift.startTime || '')
        ));
        if (shIdx >= 0) {
            const cur = nextPos.allowedShiftTypes[shIdx];
            const base = cur.quantity != null ? Number(cur.quantity) : posBase;
            nextPos.allowedShiftTypes[shIdx] = { ...cur, quantity: Math.max(0, base + delta) };
        } else {
            nextPos.quantity = Math.max(0, posBase + delta);
        }
    } else {
        nextPos.quantity = Math.max(0, posBase + delta);
    }
    return { next: nextPos, shiftCode: explicitBand };
}

/** Suma pax al puesto/turno del SLA vigente del objetivo (refuerzo estructural). */
export async function applySlaRefuerzoPax(
    sol: SolicitudRefuerzo,
    actor?: SlaActor,
): Promise<ApplySlaRefuerzoResult> {
    const addedPax = Math.max(1, Math.floor(Number(sol.cantidadPax) || 1));
    const { slaRef, fresh } = await resolveSlaRef(sol);
    const data = fresh.data();
    const positions: ServicePosition[] = [...(data.positions || [])];
    const pos = matchPosition(positions, sol);
    if (!pos) throw new Error('No se encontró el puesto del SLA para aplicar el refuerzo');

    const posIdx = positions.indexOf(pos);
    const from = normalizeYmd(sol.fecha);
    const hasRange = !!String(sol.fechaHasta || '').trim();
    const to = hasRange ? normalizeYmd(sol.fechaHasta) : from;
    const temporary = hasRange;

    let nextPos: ServicePosition;
    let shiftCode: string;

    if (temporary) {
      nextPos = {
        ...pos,
        allowedShiftTypes: [...(pos.allowedShiftTypes || [])],
        paxBoostRanges: appendPaxBoostRange(pos.paxBoostRanges, {
          from,
          to,
          delta: addedPax,
          solicitudId: sol.id,
          label: `+${addedPax} rotación`,
        }),
      };
      shiftCode = '';
    } else {
      const applied = applyPaxDelta(pos, sol, addedPax);
      nextPos = applied.next;
      shiftCode = applied.shiftCode;
    }

    positions[posIdx] = nextPos;

    const logEntry: Omit<SlaChangeLogEntry, 'at'> = {
        action: 'REFUERZO_ESTRUCTURAL',
        detail: temporary
            ? `+${addedPax} rotación en ${nextPos.name} (${from} → ${to}) · temporal`
            : shiftCode
                ? `+${addedPax} pax en ${nextPos.name} · ${shiftCode} desde ${from || '—'}`
                : `+${addedPax} rotación en ${nextPos.name} (todas las bandas) desde ${from || '—'}`,
        byUid: actor?.uid,
        byName: actor?.name,
        solicitudId: sol.id,
        positionId: nextPos.id,
        positionName: nextPos.name,
        shiftCode,
        paxDelta: addedPax,
    };

    await updateDoc(slaRef, {
        positions,
        updatedAt: Timestamp.now(),
        lastRefuerzoSolicitudId: sol.id || null,
        changeLog: appendSlaChangeLog(data.changeLog as SlaChangeLogEntry[] | undefined, logEntry),
    });

    return {
        slaId: slaRef.id,
        positionName: nextPos.name,
        shiftCode,
        addedPax,
        positionId: nextPos.id,
    };
}

/** Resta el pax aplicado por un refuerzo estructural (cancelación). */
export async function revertSlaRefuerzoPax(
    sol: SolicitudRefuerzo,
    actor?: SlaActor,
): Promise<ApplySlaRefuerzoResult> {
    const revertPax = Math.max(1, Math.floor(Number(sol.slaAppliedPax ?? sol.cantidadPax) || 1));
    const { slaRef, fresh } = await resolveSlaRef(sol);
    const data = fresh.data();
    const positions: ServicePosition[] = [...(data.positions || [])];
    const pos = matchPosition(positions, {
        ...sol,
        positionId: sol.slaAppliedPositionId || sol.positionId,
        shiftCode: sol.slaAppliedShiftCode || sol.shiftCode,
    });
    if (!pos) throw new Error('No se encontró el puesto del SLA para revertir el refuerzo');

    const posIdx = positions.indexOf(pos);
    const from = normalizeYmd(sol.fecha);
    const hasRange = !!String(sol.fechaHasta || '').trim();
    const to = hasRange ? normalizeYmd(sol.fechaHasta) : from;
    const temporary = hasRange;

    let nextPos: ServicePosition;
    let shiftCode: string;

    if (temporary) {
      nextPos = {
        ...pos,
        allowedShiftTypes: [...(pos.allowedShiftTypes || [])],
        paxBoostRanges: removePaxBoostBySolicitudId(pos.paxBoostRanges, sol.id),
      };
      shiftCode = '';
    } else {
      const applied = applyPaxDelta(pos, sol, -revertPax);
      nextPos = applied.next;
      shiftCode = applied.shiftCode;
    }
    positions[posIdx] = nextPos;

    const logEntry: Omit<SlaChangeLogEntry, 'at'> = {
        action: 'REVERT_REFUERZO',
        detail: temporary
            ? `−${revertPax} rotación temporal en ${nextPos.name} (${from} → ${to})`
            : `−${revertPax} pax en ${nextPos.name}${shiftCode ? ` · ${shiftCode}` : ''} (cancelación estructural)`,
        byUid: actor?.uid,
        byName: actor?.name,
        solicitudId: sol.id,
        positionId: nextPos.id,
        positionName: nextPos.name,
        shiftCode,
        paxDelta: -revertPax,
    };

    await updateDoc(slaRef, {
        positions,
        updatedAt: Timestamp.now(),
        changeLog: appendSlaChangeLog(data.changeLog as SlaChangeLogEntry[] | undefined, logEntry),
    });

    return {
        slaId: slaRef.id,
        positionName: nextPos.name,
        shiftCode,
        addedPax: -revertPax,
        positionId: nextPos.id,
    };
}

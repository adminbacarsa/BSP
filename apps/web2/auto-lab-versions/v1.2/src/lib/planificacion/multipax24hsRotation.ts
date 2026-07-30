import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { computePositionRequiredHeadcount, headcountPerPax24hs } from './objectiveHeadcount';
import { mtnOpeningSlotFromGroupOffset } from './rotativeMtnCycle';

export function is24hsPositionDef(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
}

/** Pax en servicio simultáneo del puesto 24hs (campo qty del SLA). */
export function pax24hsQty(pos: V2PositionDef): number {
    return Math.max(1, Number(pos.qty) || 1);
}

function mtnRing(shiftCodes: string[]): string[] {
    const mtn = shiftCodes.filter((c) => ['M', 'T', 'N'].includes(String(c || '').toUpperCase()));
    return mtn.length >= 3 ? mtn : (shiftCodes.length > 0 ? shiftCodes : ['M', 'T', 'N']);
}

/**
 * Multipax 24hs = `qty` pools de rotación M/T/N independientes (ej. qty=2 → 2×4 guardias).
 * Cada pool aporta 1 persona por banda; en conjunto cubren `qty` por M, T y N.
 */
export function iterMultipax24hsPools(
    pos: V2PositionDef,
    group: string[],
    cycleKey: string = '6+2',
): string[][] {
    const qty = pax24hsQty(pos);
    if (qty <= 1) return group.length > 0 ? [group] : [];
    const poolSize = headcountPerPax24hs(cycleKey);
    const pools: string[][] = [];
    for (let paxIdx = 0; paxIdx < qty; paxIdx++) {
        const slice = group.slice(paxIdx * poolSize, (paxIdx + 1) * poolSize);
        if (slice.length > 0) pools.push(slice);
    }
    const assigned = new Set(pools.flat());
    const remainder = group.filter((id) => !assigned.has(id));
    if (remainder.length > 0) {
        if (pools.length > 0) pools[pools.length - 1].push(...remainder);
        else pools.push(remainder);
    }
    return pools;
}

/**
 * Asigna banda primaria y slot de rotación para puesto 24hs multipax.
 */
export function assignMultipax24hsRotationSlots(
    pos: V2PositionDef,
    group: string[],
    shiftCodes: string[],
    empPrimaryShift: Record<string, string | null>,
    empRotationSlot: Record<string, number>,
    globalStaggerByEmp?: Record<string, number>,
    cycleKey: string = '6+2',
): void {
    const qty = pax24hsQty(pos);
    const ring = mtnRing(shiftCodes);
    const ringLen = ring.length;

    if (qty <= 1) {
        group.forEach((empId, idx) => {
            const slot = idx % ringLen;
            empPrimaryShift[empId] = ring[slot];
            empRotationSlot[empId] = slot;
            if (globalStaggerByEmp) globalStaggerByEmp[empId] = idx;
        });
        return;
    }

    const pools = iterMultipax24hsPools(pos, group, cycleKey);
    pools.forEach((subGroup, paxIdx) => {
        subGroup.forEach((empId, idxInPool) => {
            const slot = ringLen > 1 ? (idxInPool + paxIdx + 1) % ringLen : 0;
            empPrimaryShift[empId] = ring[slot];
            empRotationSlot[empId] = slot;
            if (globalStaggerByEmp) {
                globalStaggerByEmp[empId] = paxIdx * headcountPerPax24hs(cycleKey) + idxInPool;
            }
        });
    });
}

/**
 * Offsets de ciclo 6+2 por sub-pool (cuarteto por pax).
 */
export function assignMultipax24hsGroupOffsets(
    pos: V2PositionDef,
    group: string[],
    shiftCodes: string[],
    eCL: number,
    eCF: number,
    bandBase: number,
    empGroupIdx: Record<string, number>,
    empCycleLen: Record<string, number>,
    empCL_map: Record<string, number>,
    empMtnOpeningSlot?: Record<string, number>,
    cycleKey: string = '6+2',
): void {
    const qty = pax24hsQty(pos);
    const eCycleLen = eCL + eCF;

    if (qty <= 1) {
        const spreadStep = Math.max(1, Math.floor(eCycleLen / Math.max(1, group.length)));
        group.forEach((empId, idx) => {
            empGroupIdx[empId] = (bandBase + spreadStep * idx) % eCycleLen;
            empCycleLen[empId] = eCycleLen;
            empCL_map[empId] = eCL;
            if (empMtnOpeningSlot) {
                empMtnOpeningSlot[empId] = mtnOpeningSlotFromGroupOffset(empGroupIdx[empId], eCycleLen);
            }
        });
        return;
    }

    const pools = iterMultipax24hsPools(pos, group, cycleKey);
    const spreadStep = Math.max(1, Math.floor(eCycleLen / Math.max(1, headcountPerPax24hs(cycleKey))));
    pools.forEach((subGroup, paxIdx) => {
        const poolBase = (bandBase + paxIdx * 2) % eCycleLen;
        subGroup.forEach((empId, idxInPool) => {
            const offset = (poolBase + spreadStep * idxInPool) % eCycleLen;
            empGroupIdx[empId] = offset;
            empCycleLen[empId] = eCycleLen;
            empCL_map[empId] = eCL;
            if (empMtnOpeningSlot) {
                empMtnOpeningSlot[empId] = mtnOpeningSlotFromGroupOffset(offset, eCycleLen);
            }
        });
    });
}

/**
 * Reparte legajos 24hs qty=1 entre puestos según cupo estructural (no reparto plano).
 * Excluye puestos multipax (qty>1) del pool compartido.
 */
export function rebalance24hsPositionGroupsByNeed(
    positions: V2PositionDef[],
    positionGroups: Record<string, string[]>,
    empAssignedTo: Record<string, string | null>,
    positionNeed: Record<string, number>,
    cycleKey: string = '6+2',
    globalStaggerByEmp?: Record<string, number>,
): void {
    const rotPositions = positions.filter((p) => {
        if (isCustomCoverPosition(p) || !is24hsPositionDef(p)) return false;
        return pax24hsQty(p) === 1;
    });
    if (rotPositions.length < 2) return;

    const rotNames = rotPositions.map((p) => p.positionName);
    const pool: string[] = [];
    for (const name of rotNames) {
        for (const id of positionGroups[name] || []) {
            if (!pool.includes(id)) pool.push(id);
        }
    }
    if (pool.length === 0) return;

    const needByName = new Map<string, number>();
    for (const pos of rotPositions) {
        needByName.set(
            pos.positionName,
            Math.max(1, positionNeed[pos.positionName] ?? computePositionRequiredHeadcount(pos, cycleKey)),
        );
    }

    rotNames.forEach((n) => { positionGroups[n] = []; });

    let cursor = 0;
    while (cursor < pool.length) {
        let assigned = false;
        for (const name of rotNames) {
            const cap = needByName.get(name) ?? 1;
            if ((positionGroups[name]?.length ?? 0) >= cap) continue;
            const empId = pool[cursor++];
            positionGroups[name].push(empId);
            empAssignedTo[empId] = name;
            if (globalStaggerByEmp) {
                globalStaggerByEmp[empId] = positionGroups[name].length - 1;
            }
            assigned = true;
            if (cursor >= pool.length) break;
        }
        if (!assigned) break;
    }

    for (let i = cursor; i < pool.length; i++) {
        const empId = pool[i];
        let target: string | null = null;
        let maxGap = -1;
        for (const name of rotNames) {
            const cap = needByName.get(name) ?? 1;
            const have = positionGroups[name]?.length ?? 0;
            const gap = cap - have;
            if (gap > maxGap) {
                maxGap = gap;
                target = name;
            }
        }
        if (!target || maxGap <= 0) {
            empAssignedTo[empId] = null;
            continue;
        }
        positionGroups[target].push(empId);
        empAssignedTo[empId] = target;
    }
}

/** Recorta grupos 24hs al cupo estructural tras rebalanceo. */
export function trim24hsPositionGroupsToNeed(
    positions: V2PositionDef[],
    positionGroups: Record<string, string[]>,
    empAssignedTo: Record<string, string | null>,
    positionNeed: Record<string, number>,
    cycleKey: string = '6+2',
): void {
    for (const pos of positions) {
        if (isCustomCoverPosition(pos) || !is24hsPositionDef(pos)) continue;
        const cap = Math.max(1, positionNeed[pos.positionName] ?? computePositionRequiredHeadcount(pos, cycleKey));
        const group = positionGroups[pos.positionName] ?? [];
        while (group.length > cap) {
            const excessId = group.pop();
            if (excessId) empAssignedTo[excessId] = null;
        }
    }
}

import * as admin from 'firebase-admin';
import type { LiquidacionSnapshot } from './calc';

export type LockedSnapshotLookup =
    | { locked: false }
    | { locked: true; snapshot: LiquidacionSnapshot };

function timestampIso(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
    if (typeof (value as { toDate?: unknown }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate().toISOString();
    }
    return null;
}

export async function readLockedLiquidacionSnapshot(params: {
    cycleId: string;
    empresaId: string;
    page?: number;
    pageSize?: number;
    clientIdFilter?: string;
}): Promise<LockedSnapshotLookup> {
    const lock = await admin.firestore().collection('payroll_cycles_locks').doc(params.cycleId).get();
    if (!lock.exists) return { locked: false };

    const data = lock.data() || {};
    if (String(data.empresaId || '') !== params.empresaId) return { locked: false };

    if (params.clientIdFilter) {
        throw new Error('locked_client_filter_not_available');
    }

    const stored = data.snapshot as LiquidacionSnapshot | undefined;
    if (!stored || !Array.isArray(stored.items)) {
        throw new Error('locked_snapshot_missing');
    }

    const total = Number(stored.pagination?.total ?? stored.items.length);
    if (stored.items.length < total) {
        throw new Error('locked_snapshot_incomplete');
    }

    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(params.pageSize) || 100));
    const start = (page - 1) * pageSize;

    return {
        locked: true,
        snapshot: {
            ...stored,
            lockedAt: timestampIso(data.lockedAt) || stored.lockedAt,
            items: stored.items.slice(start, start + pageSize),
            pagination: { page, pageSize, total },
        },
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payrollCycleLockId = payrollCycleLockId;
exports.readLockedLiquidacionSnapshot = readLockedLiquidacionSnapshot;
const admin = require("firebase-admin");
function payrollCycleLockId(empresaId, cycleId) {
    return `${encodeURIComponent(String(empresaId || '').trim())}_${cycleId}`;
}
function timestampIso(value) {
    if (!value)
        return null;
    if (value instanceof admin.firestore.Timestamp)
        return value.toDate().toISOString();
    if (typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    return null;
}
async function readLockedLiquidacionSnapshot(params) {
    const lockId = payrollCycleLockId(params.empresaId, params.cycleId);
    const lock = await admin.firestore().collection('payroll_cycles_locks').doc(lockId).get();
    if (!lock.exists)
        return { locked: false };
    const data = lock.data() || {};
    if (String(data.empresaId || '') !== params.empresaId)
        return { locked: false };
    if (params.clientIdFilter) {
        throw new Error('locked_client_filter_not_available');
    }
    const stored = data.snapshot;
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
//# sourceMappingURL=lockedSnapshot.js.map
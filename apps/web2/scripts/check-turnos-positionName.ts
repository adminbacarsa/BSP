process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

async function main() {
    const oid = '1768936428905';
    const snap = await db.collection('turnos')
        .where('objectiveId', '==', oid)
        .where('startTime', '>=', Timestamp.fromDate(new Date('2026-06-01T00:00:00')))
        .where('startTime', '<=', Timestamp.fromDate(new Date('2026-06-30T23:59:59')))
        .get();
    let withPos = 0, withoutPos = 0, billWith = 0, billWithout = 0;
    const NON = new Set(['F', 'FF', 'FP', 'RET', 'V', 'L', 'A', 'E', 'AA', 'PG']);
    snap.docs.forEach(d => {
        const data = d.data() as any;
        const code = String(data.code || '').toUpperCase();
        const bill = !NON.has(code);
        if (data.positionName) { withPos++; if (bill) billWith++; }
        else { withoutPos++; if (bill) billWithout++; }
    });
    console.log(`Turnos jun 2026: ${snap.size}`);
    console.log(`con positionName: ${withPos} | sin: ${withoutPos}`);
    console.log(`billable con pos: ${billWith} | billable sin pos: ${billWithout}`);
}

main().catch(e => { console.error(e); process.exit(1); });

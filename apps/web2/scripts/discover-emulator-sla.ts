process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

async function main() {
    const slas = await db.collection('servicios_sla').limit(30).get();
    console.log(`SLAs en emulador: ${slas.size}`);
    for (const d of slas.docs) {
        const data = d.data();
        const positions = (data.positions || []) as Array<{ name?: string; quantity?: number }>;
        const posSummary = positions.map(p => `${p.name}:${p.quantity}`).join(', ');
        console.log(`  ${d.id} | objectiveId=${data.objectiveId} | ${data.name || data.clientName || ''} | ${posSummary}`);
    }

    const clients = await db.collection('clients').limit(20).get();
    console.log(`\nClientes: ${clients.size}`);
    for (const c of clients.docs) {
        const data = c.data();
        const objs = (data.objetivos || []) as Array<{ id?: string; nombre?: string; name?: string }>;
        for (const o of objs) {
            const name = o.nombre || o.name || '';
            if (/misericordia|1768936428905/i.test(name) || o.id === '1768936428905') {
                console.log(`  Misericordia? client=${c.id} obj=${o.id} name=${name}`);
            }
        }
    }

    const emps = await db.collection('empleados').limit(5).get();
    console.log(`\nEmpleados (muestra): ${emps.size} docs en query limit 5`);
    const byObj = await db.collection('empleados').where('preferredObjectiveId', '==', '1768936428905').limit(3).get();
    console.log(`Empleados preferredObjectiveId=1768936428905: ${byObj.size}`);
}

main().catch(e => { console.error(e); process.exit(1); });

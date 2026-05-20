/**
 * Diagnóstico multi-tenant en Firestore (producción o emulador).
 *
 * Uso:
 *   node scripts/diagnose-tenant-data.js --empresa bacarsa --client-name CASISA
 *   node scripts/diagnose-tenant-data.js --empresa bacarsa --objective "Obrador Malagueño"
 *
 * Producción: quitar FIRESTORE_EMULATOR_HOST y tener GOOGLE_APPLICATION_CREDENTIALS
 * o `firebase login` + proyecto comtroldata.
 */

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('Modo: Firestore producción (comtroldata)');
} else {
  console.log('Modo: emulador', process.env.FIRESTORE_EMULATOR_HOST);
}

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}

const db = getFirestore();

function parseArgs() {
  const args = process.argv.slice(2);
  let empresaId = 'bacarsa';
  let clientName = '';
  let objectiveName = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) empresaId = args[++i];
    if (args[i] === '--client-name' && args[i + 1]) clientName = args[++i];
    if (args[i] === '--objective' && args[i + 1]) objectiveName = args[++i];
  }
  return { empresaId, clientName, objectiveName };
}

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

function toYyyyMmDd(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value && typeof value.toDate === 'function') {
    const d = value.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'object') {
    const sec = value.seconds ?? value._seconds;
    if (typeof sec === 'number') {
      const d = new Date(sec * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return String(value).trim().slice(0, 10);
}

function slaCoversMonth(startDate, endDate, year, month) {
  const start = toYyyyMmDd(startDate) || '1970-01-01';
  const end = toYyyyMmDd(endDate) || '2099-12-31';
  const viewStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const viewEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
  return start <= viewEnd && end >= viewStart;
}

async function main() {
  const { empresaId, clientName, objectiveName } = parseArgs();
  const empSnap = await db.collection('empresas').doc(empresaId).get();
  const migracionCompleta = empSnap.exists && empSnap.data()?.migracionCompleta === true;
  console.log('\nEmpresa', empresaId, 'migracionCompleta:', migracionCompleta);

  const counts = {};
  for (const col of ['turnos', 'clients', 'empleados', 'servicios_sla', 'planificacion_estados']) {
    const snap = await db.collection(col).limit(8000).get();
    const byEmp = {};
    let legacy = 0;
    snap.docs.forEach((d) => {
      const emp = String(d.data().empresaId ?? '').trim() || '(sin empresaId)';
      byEmp[emp] = (byEmp[emp] || 0) + 1;
      if (!d.data().empresaId) legacy += 1;
    });
    counts[col] = { total: snap.docs.length, legacy, byEmp };
    console.log(`\n${col}: ${snap.docs.length} docs (legacy sin empresaId: ${legacy})`);
    Object.entries(byEmp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([k, n]) => console.log(`  ${k}: ${n}`));
  }

  if (clientName) {
    const clients = await db.collection('clients').limit(500).get();
    const match = clients.docs.filter((d) => {
      const name = norm(d.data().name || d.data().razonSocial);
      return name.includes(norm(clientName));
    });
    console.log(`\nClientes matching "${clientName}":`, match.length);
    for (const c of match) {
      const data = c.data();
      console.log(' -', c.id, data.name || data.razonSocial, 'empresaId:', data.empresaId || '(legacy)');
      const objs = data.objetivos || [];
      const turnosSnap = await db.collection('turnos').where('clientId', '==', c.id).limit(2000).get();
      for (const o of objs) {
        if (objectiveName && !norm(o.name).includes(norm(objectiveName))) continue;
        const oid = o.id || o.objectiveId || o.name;
        let forObj = 0;
        let wrongEmp = 0;
        turnosSnap.docs.forEach((t) => {
          if (String(t.data().objectiveId || '') !== String(oid)) return;
          forObj += 1;
          const te = String(t.data().empresaId ?? '').trim();
          if (te && te.toLowerCase() !== empresaId.toLowerCase()) wrongEmp += 1;
        });
        console.log(`    objetivo ${o.name} (${oid}): turnos=${forObj}, otra empresaId=${wrongEmp}`);

        const slaSnap = await db.collection('servicios_sla').where('clientId', '==', c.id).get();
        const slaForObj = slaSnap.docs.filter((d) => {
          const data = d.data();
          const on = norm(data.objectiveName);
          const oi = String(data.objectiveId ?? '');
          return (
            oi === String(oid) ||
            on === norm(o.name) ||
            on.includes(norm(objectiveName || o.name))
          );
        });
        console.log(`      servicios_sla vinculados: ${slaForObj.length}`);
        for (const s of slaForObj) {
          const data = s.data();
          const start = toYyyyMmDd(data.startDate);
          const end = toYyyyMmDd(data.endDate);
          const may2026 = slaCoversMonth(data.startDate, data.endDate, 2026, 4);
          console.log(
            `        ${s.id} status=${data.status || '(vacío)'} objectiveId=${data.objectiveId} objectiveName=${data.objectiveName}`,
          );
          console.log(
            `          fechas ${start} → ${end} (tipo start=${data.startDate?.constructor?.name || typeof data.startDate}) mayo2026=${may2026} empresaId=${data.empresaId || '(legacy)'}`,
          );
          const pos = data.positions;
          const posN = Array.isArray(pos) ? pos.length : pos && typeof pos === 'object' ? Object.keys(pos).length : 0;
          console.log(`          puestos=${posN} totalMonthlyHours=${data.totalMonthlyHours ?? '?'}`);
        }
      }
    }
  }

  console.log('\nListo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * SLA agrupados (un doc que cruza más de un mes): lista por empresa cuántos
 * documentos crearía «Separar por meses». No pisa un mes que ya tenga SLA y
 * no parte un cerrado.
 *
 * dry-run por defecto. Escribir solo con --apply --allow-prod (OK de Mauro).
 *
 *   node --experimental-strip-types scripts/servicios/auditar-agrupados.mjs --empresa bacarsa
 *   node --experimental-strip-types scripts/servicios/auditar-agrupados.mjs --empresa bacarsa --apply --allow-prod
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { newSlaBornClosed, localTodayYmd } from '../../apps/web2/src/lib/servicios/newSlaDraft.ts';
import {
  newSlaSeriesId,
  planSepararPorMeses,
  vigenciaAbarcaVariosMeses,
} from '../../apps/web2/src/lib/servicios/slaMonthSplit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');

function argValor(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
}

const empresaId = argValor('--empresa');

function ymd(v) {
  if (!v) return '';
  if (typeof v?.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function run() {
  if (!empresaId) {
    console.error('Falta --empresa X');
    process.exit(1);
  }
  if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
    console.error('Para escribir en prod hace falta --apply --allow-prod juntos. No se escribió nada.');
    process.exit(1);
  }
  if (apply && allowProd && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('Apply en producción: solo con OK de Mauro. Seguí únicamente si ese OK está dado.');
  }
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  }
  const db = admin.firestore();
  const snap = await db.collection('servicios_sla').where('empresaId', '==', empresaId).get();
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ref: d.ref,
      ...data,
      startDate: ymd(data.startDate),
      endDate: ymd(data.endDate),
    };
  });
  const agrupados = rows.filter((row) => vigenciaAbarcaVariosMeses(row.startDate, row.endDate) && row.closed !== true && String(row.status || 'active').toLowerCase() !== 'inactive');
  console.log(`Empresa ${empresaId} · SLA leídos ${rows.length} · agrupados abiertos ${agrupados.length} · ${apply ? 'APPLY' : 'DRY RUN'}`);
  let crearia = 0;
  const planes = [];
  for (const sla of agrupados) {
    const plan = planSepararPorMeses({ sla, existing: rows });
    const n = plan.crear.length;
    crearia += n;
    const nombre = `${sla.clientName || sla.clientId || '?'} · ${sla.objectiveName || sla.objectiveId || '?'}`;
    console.log(`  ${nombre}  ${sla.startDate} → ${sla.endDate}  ${plan.error || plan.summary}`);
    if (!plan.error) planes.push({ sla, plan });
  }
  console.log(`Docs que se crearían: ${crearia}`);
  if (!apply) {
    console.log('DRY RUN: no se escribió nada.');
    return;
  }
  const today = localTodayYmd();
  let creados = 0;
  for (const { sla, plan } of planes) {
    const seriesId = plan.seriesId || newSlaSeriesId();
    const conservar = plan.conservar;
    await sla.ref.update({
      startDate: conservar.startDate,
      endDate: conservar.endDate,
      slaSeriesId: seriesId,
    });
    for (const seg of plan.crear) {
      const copy = { ...sla };
      delete copy.id;
      delete copy.ref;
      const born = newSlaBornClosed(seg.endDate, today);
      await db.collection('servicios_sla').add({
        ...copy,
        startDate: seg.startDate,
        endDate: seg.endDate,
        slaSeriesId: seriesId,
        status: 'active',
        closed: born,
        ...(born ? { closedReason: 'VENCIDO' } : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'SEPARAR_POR_MESES',
      });
      creados += 1;
    }
    await db.collection('audit_logs').add({
      action: 'UPDATE_CONTRACT',
      module: 'SERVICES',
      actorName: 'script auditar-agrupados',
      actorUid: 'SYSTEM',
      empresaId,
      objectiveId: sla.objectiveId || null,
      slaId: sla.id,
      detail: `Separó por meses (${plan.crear.map((s) => s.label).join(', ')}): ${sla.clientName || ''} - ${sla.objectiveName || ''}`,
      timestamp: new Date().toISOString(),
      metadata: { via: 'AUDITAR_AGRUPADOS' },
    });
  }
  console.log(`Aplicado: ${creados} servicios nuevos.`);
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

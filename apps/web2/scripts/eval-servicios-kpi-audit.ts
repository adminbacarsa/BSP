/**
 * Audita KPI «Servicios activos» vs «con servicio» del catálogo.
 * Uso (prod, credenciales ADC/gcloud):
 *   npx tsx scripts/eval-servicios-kpi-audit.ts --year 2026 --month 7
 * Emulador:
 *   $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'; npx tsx scripts/eval-servicios-kpi-audit.ts
 */
import './eval-bootstrap-env';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { toYyyyMmDd } from '../src/lib/firestoreDates';
import { filterSlaRowsByEmpresa, filterRowsByEmpresa } from '../src/lib/multiempresa';
import {
  auditServiciosKpiMonth,
  type ServiciosKpiAuditResult,
} from '../src/lib/servicios/serviciosObjectiveCatalog';
import type { ServiceSLA } from '../src/services/slaService';

if (!getApps().length) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'comtroldata' });
const db = getFirestore();

function parseArgs() {
  const args = process.argv.slice(2);
  let year = 2026;
  let month = 6; // julio 0-based
  let empresaId = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--year' && args[i + 1]) year = Number(args[++i]);
    else if (a === '--month' && args[i + 1]) month = Number(args[++i]) - 1;
    else if (a === '--empresa' && args[i + 1]) empresaId = String(args[++i]).trim();
    else if (/^\d{4}$/.test(a) && args[i + 1] && /^\d{1,2}$/.test(args[i + 1]!)) {
      year = Number(a);
      month = Number(args[++i]) - 1;
    }
  }
  return { year, month, empresaId };
}

function printAudit(audit: ServiciosKpiAuditResult) {
  const monthLabel = new Date(audit.year, audit.month, 1).toLocaleString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
  console.log('\n=== Auditoría Servicios KPI ===');
  console.log(`Mes: ${monthLabel}`);
  console.log(`KPI contratos activos (tarjeta): ${audit.kpiActiveCount}`);
  console.log(`Catálogo objetivos con servicio: ${audit.catalogWithSlaCount}`);
  console.log(`Catálogo objetivos totales: ${audit.catalogTotalObjectives}`);
  console.log(`Delta (contratos − objetivos): ${audit.delta}`);

  if (audit.objectivesWithMultipleInMonth.length > 0) {
    console.log('\n--- Objetivos con MÁS DE UN contrato solapando el mes ---');
    for (const g of audit.objectivesWithMultipleInMonth) {
      console.log(`\n${g.clientName} · ${g.objectiveName} (${g.contracts.length} contratos)`);
      for (const c of g.contracts) {
        console.log(
          `  · id=${c.id} | ${c.startDate} → ${c.endDate} | status=${c.status ?? '(vacío)'}`,
        );
      }
    }
  } else {
    console.log('\n(Sin objetivos con doble contrato en el mes)');
  }

  if (audit.orphanContracts.length > 0) {
    console.log('\n--- Contratos huérfanos (solapan mes, sin objetivo CRM «con servicio») ---');
    for (const c of audit.orphanContracts) {
      console.log(
        `  · id=${c.id} | ${c.clientName} · ${c.objectiveName} | ${c.startDate} → ${c.endDate}`,
      );
    }
  }

  if (audit.delta === 0) {
    console.log('\nOK: KPI y catálogo coinciden.');
  } else if (audit.objectivesWithMultipleInMonth.length > 0) {
    const extraFromDupes = audit.objectivesWithMultipleInMonth.reduce(
      (s, g) => s + g.contracts.length - 1,
      0,
    );
    console.log(
      `\nExplicación: +${extraFromDupes} contrato(s) extra por solapamiento en el mismo objetivo.`,
    );
  } else if (audit.orphanContracts.length > 0) {
    console.log(`\nExplicación: ${audit.orphanContracts.length} contrato(s) huérfano(s).`);
  }

  console.log('\nNota: «eliminar junio» con excludedDates NO baja el KPI; solo cambian startDate/endDate o borrar el doc SLA.');
}

async function main() {
  const { year, month, empresaId } = parseArgs();

  const [slaSnap, clientSnap] = await Promise.all([
    db.collection('servicios_sla').get(),
    db.collection('clients').get(),
  ]);

  const clientsRaw = clientSnap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  let clients = clientsRaw;
  let services = slaSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      startDate: toYyyyMmDd(data.startDate),
      endDate: toYyyyMmDd(data.endDate),
      positions: data.positions || [],
    } as ServiceSLA & { id: string };
  });

  if (empresaId) {
    const clientIds = new Set(
      clientsRaw.filter((c: any) => String(c.empresaId ?? '') === empresaId).map((c: any) => c.id),
    );
    clients = filterRowsByEmpresa(clientsRaw, empresaId, true) as typeof clientsRaw;
    services = filterSlaRowsByEmpresa(services, empresaId, true, clientIds) as typeof services;
  }

  const audit = auditServiciosKpiMonth(clients, services, year, month);
  printAudit(audit);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

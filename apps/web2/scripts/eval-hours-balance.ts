/**
 * Smoke del extracto mensual de horas (cuenta corriente SLA / plan / real).
 * Uso: npm run eval:hours-balance
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'AIzaSyEvalOnlyNotARealKey00000000000';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'demo';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'demo.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:1:web:1';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= 'demo.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= '0';

async function main() {
  const { Timestamp } = await import('firebase/firestore');
  const {
    buildHoursBalanceMonth,
    balancesCoverPeriodKeys,
    balancesCoverObjectives,
    sumBalancesByClient,
  } = await import('../src/lib/hoursBalance/buildHoursBalance');
  const {
    hoursBalanceDocId,
    hoursBalancePeriodKey,
  } = await import('../src/lib/hoursBalance/types');

  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) {
      failed += 1;
      console.error('FAIL', msg);
    } else {
      console.log('ok  ', msg);
    }
  }

  const ts = (d: Date) => Timestamp.fromDate(d);

  const sla = {
    id: 'sla1',
    status: 'active',
    clientId: 'cli1',
    clientName: 'Cliente Demo',
    objectiveId: 'obj1',
    objectiveName: 'Objetivo Demo',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    positions: [
      {
        id: 'p1',
        name: 'Puesto 1',
        coverageType: 'custom' as const,
        quantity: 1,
        activeDays: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
        allowedShiftTypes: [
          { code: 'M', name: 'Mañana', startTime: '06:00', endTime: '14:00', hours: 8 },
        ],
      },
    ],
  };

  const planStart = new Date(2026, 7, 10, 6, 0, 0);
  const planEnd = new Date(2026, 7, 10, 14, 0, 0);
  const turnos = [
    {
      id: 't1',
      objectiveId: 'obj1',
      clientId: 'cli1',
      employeeId: 'e1',
      employeeName: 'Guardia',
      code: 'M',
      hours: 8,
      startTime: ts(planStart),
      endTime: ts(planEnd),
      realStartTime: ts(planStart),
      realEndTime: ts(planEnd),
    },
  ];

  const rows = buildHoursBalanceMonth({
    empresaId: 'bacarsa',
    year: 2026,
    month: 8,
    services: [sla as any],
    turnos,
    rebuiltFrom: 'manual',
  });

  assert(rows.length === 1, `1 fila de extracto (got ${rows.length})`);
  const row = rows[0];
  assert(row.objectiveId === 'obj1', 'objectiveId');
  assert(row.periodKey === '2026-08', `periodKey ${row.periodKey}`);
  assert(row.plannedHours === 8, `plannedHours ${row.plannedHours}`);
  assert(row.realHours === 8, `realHours ${row.realHours}`);
  assert(row.slaHours === 248, `slaHours ${row.slaHours} === 248 (31×8)`);
  assert(row.saldoPlan === 240, `saldoPlan ${row.saldoPlan} === SLA − plan`);
  assert(row.saldoReal === 240, `saldoReal ${row.saldoReal} === SLA − real`);
  assert(row.resultante === 8, `resultante ${row.resultante}`);
  assert(hoursBalancePeriodKey(2026, 8) === '2026-08', 'periodKey helper');
  assert(
    hoursBalanceDocId('bacarsa', 'obj1', 2026, 8) === 'bacarsa_obj1_2026-08',
    'docId',
  );
  assert(balancesCoverPeriodKeys(rows, ['2026-08']), 'cubre agosto');
  assert(!balancesCoverPeriodKeys(rows, ['2026-08', '2026-07']), 'no cubre julio');
  assert(balancesCoverObjectives(rows, ['2026-08'], ['obj1']), 'cubre obj1 en agosto');
  assert(!balancesCoverObjectives(rows, ['2026-08'], ['obj1', 'obj2']), 'no cubre obj2');

  const byCli = sumBalancesByClient(rows);
  assert(byCli.cli1?.planned === 8, 'suma por cliente');

  if (failed) {
    console.error(`\n${failed} fallos`);
    process.exit(1);
  }
  console.log('\nextracto mensual OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

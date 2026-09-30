/**
 * CRM (modo Publicadas) cuenta el plan como el libro: solo cronogramas publicados.
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-crm-plan-publicado.mts
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'eval-crm-plan';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';

const { onlyPublishedObjectiveTurnos, sumPlannedHoursForClient } = await import('../../apps/web2/src/lib/crm/plannedHours.ts');

function fail(msg: string): never {
  throw new Error(msg);
}

const client = { id: 'CLI', name: 'Cliente', objetivos: [{ id: 'PUB', name: 'Publicado' }, { id: 'NOPUB', name: 'Shopping Villa Maria' }] };
const range = { start: new Date('2026-09-01T03:00:00.000Z'), end: new Date('2026-10-01T02:59:59.999Z') };
const turnos = [
  { id: 'a', objectiveId: 'PUB', employeeId: 'E1', code: 'M', draft: false, startTime: '2026-09-10T11:00:00.000Z', endTime: '2026-09-10T19:00:00.000Z' },
  { id: 'b', objectiveId: 'PUB', employeeId: 'E2', code: 'T', draft: false, startTime: '2026-09-10T19:00:00.000Z', endTime: '2026-09-11T03:00:00.000Z' },
  { id: 'c', objectiveId: 'NOPUB', employeeId: 'E3', code: 'M', draft: false, startTime: '2026-09-12T11:00:00.000Z', endTime: '2026-09-12T19:00:00.000Z' },
  { id: 'd', objectiveId: 'PUB', employeeId: 'E1', code: 'N', draft: true, startTime: '2026-09-13T03:00:00.000Z', endTime: '2026-09-13T11:00:00.000Z' },
];

const antes = sumPlannedHoursForClient(turnos, client, range);
if (antes !== 24) fail(`sin filtro suma también el objetivo sin publicar: ${antes}`);

const filtrados = onlyPublishedObjectiveTurnos(turnos, new Set(['PUB']));
const despues = sumPlannedHoursForClient(filtrados, client, range);
if (despues !== 16) fail(`solo publicados debe dar 16, dio ${despues}`);
if (filtrados.some((t) => t.objectiveId === 'NOPUB')) fail('el objetivo sin cronograma publicado no puede quedar');
if (sumPlannedHoursForClient(onlyPublishedObjectiveTurnos(turnos, new Set()), client, range) !== 0) fail('sin cronogramas publicados el plan oficial es 0');

console.log('CRM_PLAN_PUBLICADO_OK');

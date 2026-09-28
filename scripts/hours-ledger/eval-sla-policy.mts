import { SLA_POLICY, classifySlaBucket } from './slaPolicy.ts';

const base = { closed: false, contractActive: true, clientActive: true, hasPublishedPlan: true };
const shopping = { ...base, hasPublishedPlan: false };
const loteria = { ...base, clientActive: true, hasPublishedPlan: true };
const inactivo = { ...base, clientActive: false };
const cerrado = { ...base, closed: true };
const tadicor = { ...base, contractActive: false };

if (SLA_POLICY.slaCountsWithoutPublishedPlan !== false) throw new Error('sin plan no entra');
if (SLA_POLICY.slaCountsInactiveClient !== false) throw new Error('cliente inactivo no entra');
if (classifySlaBucket(shopping) !== 'withoutPlan') throw new Error('Shopping va a sin plan');
if (classifySlaBucket(loteria) !== 'active') throw new Error('Lotería entra: cliente activo y publicado');
if (classifySlaBucket(inactivo) !== 'inactive') throw new Error('cliente inactivo');
if (classifySlaBucket(tadicor) !== 'inactive') throw new Error('Tadicor es inactivo');
if (classifySlaBucket(cerrado) !== 'closed') throw new Error('Peaje cerrado cuenta en su columna y en el total');
if (classifySlaBucket(shopping, { ...SLA_POLICY, slaCountsWithoutPublishedPlan: true }) !== 'active') {
  throw new Error('el flag prende el contrato sin cronograma');
}
if (classifySlaBucket(inactivo, { ...SLA_POLICY, slaCountsInactiveClient: true }) !== 'active') {
  throw new Error('el flag prende al cliente inactivo');
}
console.log('sla-policy ok');

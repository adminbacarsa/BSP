import { SLA_POLICY, assignWorkedShares, classifySlaBucket, objectiveInOperation } from './slaPolicy.ts';

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
if (!objectiveInOperation(['active'])) throw new Error('operación cuenta');
if (!objectiveInOperation(['closed'])) throw new Error('cerrado vigente cuenta');
if (objectiveInOperation(['inactive'])) throw new Error('inactivo no es operación');
if (objectiveInOperation(['withoutPlan'])) throw new Error('sin plan no es operación');
if (objectiveInOperation([])) throw new Error('sin contrato no es operación');
const split = assignWorkedShares(100, { op: 1, demo: 1 }, new Set(['op']));
if (split.worked !== 50 || split.workedOutside !== 50) throw new Error('reparto trabajadas');
if (split.worked + split.workedOutside !== 100) throw new Error('la persona no se pierde');
console.log('sla-policy ok');

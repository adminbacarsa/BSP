import { SLA_POLICY, classifySlaBucket } from './slaPolicy.ts';

const base = { closed: false, contractActive: true, clientActive: true, hasPublishedPlan: true };
const shopping = { ...base, hasPublishedPlan: false };
const loteria = { ...base, clientActive: false };

if (SLA_POLICY.slaCountsWithoutPublishedPlan !== true) throw new Error('default publicado');
if (SLA_POLICY.slaCountsInactiveClient !== false) throw new Error('default cliente inactivo');
if (classifySlaBucket(shopping) !== 'active') throw new Error('Shopping tiene que seguir en SLA activo');
if (classifySlaBucket(loteria) !== 'inactive') throw new Error('Lotería no tiene que entrar al SLA activo');
if (classifySlaBucket(shopping, { ...SLA_POLICY, slaCountsWithoutPublishedPlan: false }) !== 'skip') {
  throw new Error('el flag apagado tiene que sacar el contrato sin cronograma');
}
if (classifySlaBucket(loteria, { ...SLA_POLICY, slaCountsInactiveClient: true }) !== 'active') {
  throw new Error('el flag prendido tiene que contar al cliente inactivo');
}
if (classifySlaBucket({ ...base, closed: true }) !== 'closed') throw new Error('cerrado');
console.log('sla-policy ok');

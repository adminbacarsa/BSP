/**
 * npx tsx scripts/hours-ledger/eval-ausencia-objetivo-apply.mts
 */
import { classifyAusenciaObjetivo } from './ausenciaObjetivoApply.ts';

function fail(msg: string): never {
  throw new Error(msg);
}

const clients = new Set(['1qaCdOTjKCbXp6W4Eaqj', 'vb2fmGf2w7u9z1OQPIO7', 'CANON-NEC']);

const alta = classifyAusenciaObjetivo({ confianza: 'ALTA', propuesta: 'CANON-NEC', canonicoSugerido: '' }, clients);
if (alta.action !== 'APLICAR' || alta.objectiveId !== 'CANON-NEC') fail('ALTA en clientes se aplica');

const mediaCanon = classifyAusenciaObjetivo(
  { confianza: 'MEDIA', propuesta: 'id-viejo-cet', canonicoSugerido: 'vb2fmGf2w7u9z1OQPIO7' },
  clients,
);
if (mediaCanon.action !== 'APLICAR' || mediaCanon.objectiveId !== 'vb2fmGf2w7u9z1OQPIO7') fail('MEDIA usa el canónico por nombre');

const mediaEnCliente = classifyAusenciaObjetivo(
  { confianza: 'MEDIA', propuesta: '1qaCdOTjKCbXp6W4Eaqj', canonicoSugerido: '' },
  clients,
);
if (mediaEnCliente.action !== 'APLICAR') fail('MEDIA cuyo puesto ya está en clientes se aplica');

const helmann = classifyAusenciaObjetivo(
  { confianza: 'MEDIA', propuesta: '28lAh3BLC9QG58XooWNC', canonicoSugerido: '' },
  clients,
);
if (helmann.action !== 'DECISION_HUMANA' || helmann.objectiveId !== '') fail('HELMANN/LOPEZ no se escriben');

const ambigua = classifyAusenciaObjetivo({ confianza: 'AMBIGUA', propuesta: 'CANON-NEC' }, clients);
if (ambigua.action !== 'DECISION_HUMANA') fail('AMBIGUA no se escribe');

console.log('AUSENCIA_OBJETIVO_APPLY_OK');

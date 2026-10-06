/**
 * Alta urgente por texto (85). No abre ARCA.
 *   node scripts/eval-arca-altas-texto.mjs
 */
import { LARGO_ALTA_TEXTO, canalUrgenteDe, lineaAltaTexto, textoAltasMasivas } from '../apps/web2/src/lib/eventuales/arcaLinea.mjs';
import { extraerAcuseAltaTexto, parseErroresAltaTexto } from './arca-robot/altasTexto.mjs';

let failed = 0;
function check(name, cond) {
  if (cond) console.log('OK  ' + name);
  else { console.error('FAIL ' + name); failed += 1; }
}

const LINEA = '2012345678012280700001749210516901250000100000012102026121020260422/05   033104500001';
const invalida = lineaAltaTexto({
  contrato: { fechaAlta: '2026-10-12', fechaBaja: '2026-10-12' },
  cuil: '20123456780',
  bruto: 1000,
  obraSocial: '122807',
  empresa: { id: 'bacarsa' },
});
check('largo 85', invalida.linea.length === LARGO_ALTA_TEXTO && LINEA.length === 85);
check('coincide con la linea probada', invalida.linea === LINEA);
check('fechas ddmmaaaa', invalida.linea.slice(47, 63) === '1210202612102026');
check('CUIL invalido no enviable', invalida.enviable === false && invalida.advertencias.includes('CUIL_INVALIDO'));
check('default canal carga masiva', canalUrgenteDe({ id: 'bacarsa' }) === 'CARGA_MASIVA');
check('canal altas texto', canalUrgenteDe({ arcaEventuales: { canalUrgente: 'ALTAS_TEXTO' } }) === 'ALTAS_TEXTO');

const ok = lineaAltaTexto({
  contrato: { fechaAlta: '2026-10-12', fechaBaja: '2026-10-12' },
  cuil: '20111111112',
  bruto: 1000,
  obraSocial: '122807',
  empresa: { id: 'bacarsa' },
});
check('CUIL valido enviable', ok.enviable === true && ok.linea.slice(0, 11) === '20111111112');
const pack = textoAltasMasivas([ok.linea, ok.linea]);
check('junta dos lineas', pack.ok === true && pack.texto.split('\n').length === 2);
check('rechaza 11', textoAltasMasivas(Array.from({ length: 11 }, () => ok.linea)).ok === false);

const errs = parseErroresAltaTexto('Registro 1: CUIL invalido\nRegistro 2: fecha fin');
check('parsea Registro N', errs.length === 2 && errs[0].registro === 1 && /CUIL/i.test(errs[0].mensaje));
const acuse = extraerAcuseAltaTexto('Nro. de Alta: 1197638458\nCAT 998877');
check('lee nro y CAT si aparecen', acuse.nroTransaccion === '1197638458' && acuse.cat === '998877');
check('sin nro no inventa', extraerAcuseAltaTexto('Registro 1: CUIL invalido').nroTransaccion === '');

console.log(failed ? 'FALLARON ' + failed : 'OK arca-altas-texto');
process.exit(failed ? 1 : 0);

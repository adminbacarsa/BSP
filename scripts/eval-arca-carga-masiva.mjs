/**
 * Reglas puras del recorrido Carga Masiva (capturas 05/10).
 *   node scripts/eval-arca-carga-masiva.mjs
 */
import {
  contarLineasTxt,
  decidirNovedadAbierta,
  extraerCodigoPrincipal,
  leerEstadoCarga,
  mensajeNovedadAjena,
  nroDesdeFilaListado,
  parseFilasListado,
  validarRegistrosVsTxt,
} from './arca-robot/cargaMasiva.mjs';
import { bodyResultado } from './arca-robot/flujo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`OK  ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
}

const listadoAbierto = `
LISTADO DE NOVEDADES
Código Fecha Creación Fecha Presentación Nro. Transacción Estado Acción
245548 29/09/2026 Abierto
`;
const filas = parseFilasListado(listadoAbierto);
check('parsea fila Abierta 245548', filas.length === 1 && filas[0].codigo === '245548' && filas[0].estado === 'Abierto');

check(
  'sin abierta → NUEVO',
  decidirNovedadAbierta({ filas: [] }).accion === 'NUEVO',
);
check(
  'abierta del lote → EDITAR',
  decidirNovedadAbierta({ filas, codigoLote: '245548' }).accion === 'EDITAR'
    && decidirNovedadAbierta({ filas, codigoLote: '245548' }).codigo === '245548',
);
const ajena = decidirNovedadAbierta({ filas, codigoLote: '999999' });
check(
  'abierta ajena → ERROR sin borrar',
  ajena.accion === 'ERROR' && ajena.mensaje === mensajeNovedadAjena('245548'),
);
check(
  'sin codigo lote y hay abierta → ERROR',
  decidirNovedadAbierta({ filas }).accion === 'ERROR',
);

check(
  'extrae Código del principal',
  extraerCodigoPrincipal('INGRESO MASIVO\nCódigo: 245548\nEstado: Abierto') === '245548',
);

const cargaTxt = `Informado: NO
Estado: Pendiente
Registros: 3
`;
const estado = leerEstadoCarga(cargaTxt);
check('lee Registros=3', estado.registros === 3);
check('cuenta líneas TXT', contarLineasTxt('a\nb\n\nc\n') === 3);
check('registros = líneas OK', validarRegistrosVsTxt({ registros: 3, lineasTxt: 3 }).ok === true);
check('registros distintos falla', validarRegistrosVsTxt({ registros: 2, lineasTxt: 3 }).ok === false);

const presentadas = parseFilasListado('245548 29/09/2026 05/10/2026 987654321 Presentado');
check(
  'nro desde listado por código',
  nroDesdeFilaListado(presentadas, '245548') === '987654321',
);

const body = bodyResultado({
  loteId: 'lote_x',
  estado: 'CONFIRMADO',
  nroTransaccion: '1',
  arcaCodigoNovedad: '245548',
});
check('bodyResultado incluye arcaCodigoNovedad', body.arcaCodigoNovedad === '245548');

const selPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'arca-robot', 'selectores.json');
const sel = JSON.parse(fs.readFileSync(selPath, 'utf8'));
check('presentar marcado por confirmar', sel.presentarNovedad?.estado === 'por confirmar');
check('nro listado marcado por confirmar', sel.nroTransaccionListado?.estado === 'por confirmar');
check('borrar prohibido', sel.listadoBorrar?.prohibido === true);
check('anulación por confirmar', sel.anularRegistro?.estado === 'por confirmar');

console.log(failed ? `FALLARON ${failed}` : 'OK arca-carga-masiva');
process.exit(failed ? 1 : 0);

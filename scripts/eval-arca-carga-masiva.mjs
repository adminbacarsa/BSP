/**
 * Reglas puras del recorrido Carga Masiva (capturas 05/10).
 *   node scripts/eval-arca-carga-masiva.mjs
 */
import {
  contarLineasTxt,
  decidirNovedadAbierta,
  extraerCodigoPrincipal,
  extraerDatosConstancia,
  extraerErroresLinea,
  leerEstadoCarga,
  mensajeNovedadAjena,
  nroDesdeFilaListado,
  parseFilasListado,
  urlConstanciaSeti,
  validarCargaOk,
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

const cargaOkTxt = `Informado SI
Estado Válido
Registros 1
Archivo cargado correctamente
`;
const estadoOk = leerEstadoCarga(cargaOkTxt);
check('carga OK = Informado SI + Válido', estadoOk.ok === true && estadoOk.registros === 1);
check('cuenta líneas TXT', contarLineasTxt('a\nb\n\nc\n') === 3);
check('validarCargaOk registros', validarCargaOk({ estadoCarga: estadoOk, lineasTxt: 1 }).ok === true);
check('registros distintos falla', validarCargaOk({ estadoCarga: estadoOk, lineasTxt: 3 }).ok === false);

const invalida = leerEstadoCarga('Informado SI\nEstado Inválido\nRegistros 1\nLínea 1: CUIL del empleado no válida');
check('carga inválida', invalida.ok === false);
check('extrae errores de línea', extraerErroresLinea('Línea 1: CUIL del empleado no válida').length === 1);

const enviada = parseFilasListado('245746 05/10/2026 5/10/2026 16:03:45 1197638458 Enviado');
check('parsea Enviado + nro', enviada.length === 1 && enviada[0].estado === 'Enviado' && enviada[0].nroTransaccion === '1197638458');
check('nro desde listado por código', nroDesdeFilaListado(enviada, '245746') === '1197638458');
check('url SETI', urlConstanciaSeti('1197638458').includes('nroTransaccion=1197638458'));
const acuse = extraerDatosConstancia('Nro. verificador: 737484\nCódigo de Control: r7KG1I');
check('constancia SETI', acuse.nroVerificador === '737484' && acuse.codigoControl === 'r7KG1I');

const body = bodyResultado({
  loteId: 'lote_x',
  estado: 'CONFIRMADO',
  nroTransaccion: '1',
  arcaCodigoNovedad: '245548',
});
check('bodyResultado incluye arcaCodigoNovedad', body.arcaCodigoNovedad === '245548');

const selPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'arca-robot', 'selectores.json');
const sel = JSON.parse(fs.readFileSync(selPath, 'utf8'));
check('Enviar confirmado', sel.principalEnviar?.name === '^Enviar$' || sel.presentarNovedad?.estado === 'confirmado');
check('nro listado confirmado', sel.nroTransaccionListado?.estado === 'confirmado');
check('constancia SETI en selectores', !!sel.constanciaSeti?.url);
check('borrar prohibido', sel.listadoBorrar?.prohibido === true);
check('anulación parcial (tarjeta fecha+012)', sel.anularRegistro?.estado === 'parcial');
check('icono lápiz modificar', /lápiz|lapiz/i.test(sel.tarjetaIconoModificar?.nota || ''));
check('icono documento baja', /documento/i.test(sel.tarjetaIconoBaja?.nota || ''));
check('icono tacho anular', /tacho/i.test(sel.tarjetaIconoAnular?.nota || ''));
check('altas masivas confirmado', sel.altasMasivas?.estado === 'confirmado' && sel.altasTextoArea?.max === 10);
check('error Registro N confirmado', sel.altasTextoError?.estado === 'confirmado');
check('confirmacion altas texto por confirmar', sel.altasTextoConfirmacion?.estado === 'por confirmar' && sel.altasTextoNro?.estado === 'por confirmar');

console.log(failed ? `FALLARON ${failed}` : 'OK arca-carga-masiva');
process.exit(failed ? 1 : 0);

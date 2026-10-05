/**
 * Reglas ENVIADO ≠ CONFIRMADO, tarjeta anulación 012, advertencia relación activa.
 *   node scripts/eval-arca-verificacion.mjs
 */
import assert from 'node:assert/strict';
import {
  AVISO_RELACION_ACTIVA_EMPLEADOR,
  advertenciaRelacionActivaEmpleador,
  decidirResultadoVerificacion,
  decidirTarjetaAnulacion,
  estadoHabilitaFichada,
  fechaIsoDeArca,
  parseTarjetasRelacion,
  VENTANA_VERIFICACION_MS,
} from '../apps/web2/src/lib/eventuales/verificacionAlta.mjs';
import { ESTADOS_ENVIO, transicionEnvio } from '../apps/web2/src/lib/eventuales/arcaEnvios.mjs';

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}`);
  if (!ok) failed += 1;
}

check('estados incluyen ENVIADO y VERIFICAR', ESTADOS_ENVIO.includes('ENVIADO') && ESTADOS_ENVIO.includes('VERIFICAR'));

const aEnviado = transicionEnvio(
  { estado: 'SUBIENDO', intentos: [] },
  { estado: 'ENVIADO', origen: 'ROBOT', nroTransaccion: '1197638458', actor: 'test' },
);
check('SUBIENDO → ENVIADO con nro', aEnviado.ok === true && aEnviado.patch.estado === 'ENVIADO' && aEnviado.patch.verificacionPendiente === true);

const sinNro = transicionEnvio({ estado: 'SUBIENDO', intentos: [] }, { estado: 'ENVIADO', origen: 'ROBOT', actor: 'test' });
check('ENVIADO sin nro falla', sinNro.ok === false);

const aConfirmado = transicionEnvio(
  { estado: 'ENVIADO', nroTransaccion: '1197638458', intentos: [] },
  { estado: 'CONFIRMADO', origen: 'ROBOT', nroTransaccion: '1197638458', actor: 'test' },
);
check('ENVIADO → CONFIRMADO', aConfirmado.ok === true && aConfirmado.patch.verificacionPendiente === false);

const aVerificar = transicionEnvio(
  { estado: 'ENVIADO', nroTransaccion: '1', intentos: [] },
  { estado: 'VERIFICAR', origen: 'ROBOT', error: 'SIN_TARJETA_EN_48H', actor: 'test' },
);
check('ENVIADO → VERIFICAR', aVerificar.ok === true);

check('fichada con ENVIADO', estadoHabilitaFichada('ENVIADO'));
check('fichada con VERIFICAR', estadoHabilitaFichada('VERIFICAR'));
check('fichada no con SUBIENDO', !estadoHabilitaFichada('SUBIENDO'));

const tarjetasPrevias = [{ fechaInicio: '02/06/2023', modalidad: '014' }];
const ahora = Date.parse('2026-10-06T16:00:00.000Z');
const enviada = Date.parse('2026-10-05T16:03:45.000Z');
check(
  'sin tarjeta 012 → REINTENTAR antes de 48h',
  decidirResultadoVerificacion({
    tarjetas: tarjetasPrevias,
    fechaAlta: '2026-10-12',
    ahoraMs: ahora,
    enviadaAtMs: enviada,
  }).accion === 'REINTENTAR',
);
check(
  'sin tarjeta 012 a las 48h → VERIFICAR',
  decidirResultadoVerificacion({
    tarjetas: tarjetasPrevias,
    fechaAlta: '2026-10-12',
    ahoraMs: enviada + VENTANA_VERIFICACION_MS + 1000,
    enviadaAtMs: enviada,
  }).accion === 'VERIFICAR',
);
check(
  'tarjeta 012 + fecha → CONFIRMADO',
  decidirResultadoVerificacion({
    tarjetas: [...tarjetasPrevias, { fechaInicio: '12/10/2026', modalidad: '012' }],
    fechaAlta: '2026-10-12',
    ahoraMs: ahora,
    enviadaAtMs: enviada,
  }).accion === 'CONFIRMADO',
);

const anul = decidirTarjetaAnulacion({
  tarjetas: [
    { fechaInicio: '02/06/2023', modalidad: '014', anularDisponible: false },
    { fechaInicio: '12/10/2026', modalidad: '012', anularDisponible: true },
  ],
  fechaInicio: '2026-10-12',
});
check('anulación elige 012 no la primera', anul.accion === 'ANULAR' && fechaIsoDeArca(anul.tarjeta.fechaInicio) === '2026-10-12');
check(
  'anulación sin 012 → MANUAL',
  decidirTarjetaAnulacion({ tarjetas: tarjetasPrevias, fechaInicio: '2026-10-12' }).accion === 'MANUAL',
);
check(
  'anulación varias 012 → MANUAL',
  decidirTarjetaAnulacion({
    tarjetas: [
      { fechaInicio: '12/10/2026', modalidad: '012' },
      { fechaInicio: '12/10/2026', modalidad: '12' },
    ],
    fechaInicio: '2026-10-12',
  }).accion === 'MANUAL',
);

const adv = advertenciaRelacionActivaEmpleador({
  cuil: '20244722432',
  empresaId: 'bacarsa',
  empresaCuit: '30668134978',
  empleados: [{ cuil: '20-24472243-2', empresaId: 'bacarsa', status: 'ACTIVE', esEventual: false }],
  empresas: [{ id: 'bacarsa', cuit: '30-66813497-8' }],
});
check('advertencia relación activa mismo CUIT', adv === 'RELACION_ACTIVA_EMPLEADOR');
check('texto aviso', AVISO_RELACION_ACTIVA_EMPLEADOR.includes('relación activa'));
check(
  'eventual no dispara advertencia',
  !advertenciaRelacionActivaEmpleador({
    cuil: '20244722432',
    empresaId: 'bacarsa',
    empresaCuit: '30668134978',
    empleados: [{ cuil: '20244722432', empresaId: 'bacarsa', status: 'ACTIVE', esEventual: true }],
    empresas: [{ id: 'bacarsa', cuit: '30668134978' }],
  }),
);

const parsed = parseTarjetasRelacion('Mod. Contrato: 014\nFecha de Inicio: 02/06/2023\nMod. Contrato: 012\nFecha de Inicio: 12/10/2026');
check('parse tarjetas', parsed.length === 2 && parsed[1].modalidad === '012');

console.log(failed ? `FALLARON ${failed}` : 'OK arca-verificacion');
process.exit(failed ? 1 : 0);

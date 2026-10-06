/**
 * node --import ./src/lib/ts-ext-register.mjs --experimental-strip-types --test src/lib/consultasDisponibilidadQuery.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  argsPreviewConsulta,
  consultaSigueAbierta,
  consultasListenKeys,
  lineaInformativaConsulta,
  textoRespuestaCerrada,
} from './consultasDisponibilidadQuery';

const SA = 'uid-superadmin';
const CUIL = '20334141463';

describe('consultasListenKeys', () => {
  it('vista previa de eventual sin app: bolsaCuil, no el uid del SuperAdmin', () => {
    const keys = consultasListenKeys({
      isPreviewMode: true,
      authUid: SA,
      bolsaCuil: CUIL,
      employeeIds: [],
    });
    assert.deepEqual(keys, [{ field: 'bolsaCuil', value: CUIL }]);
    assert.equal(keys.some((k) => k.field === 'uid'), false);
  });

  it('vista previa de guardia: employeeId, no el uid del SuperAdmin', () => {
    const keys = consultasListenKeys({
      isPreviewMode: true,
      authUid: SA,
      bolsaCuil: null,
      employeeIds: ['emp-guardia'],
    });
    assert.deepEqual(keys, [{ field: 'employeeId', value: 'emp-guardia' }]);
  });

  it('eventual real: uid y bolsaCuil del claim (la invitación puede no tener uid)', () => {
    const keys = consultasListenKeys({
      isPreviewMode: false,
      authUid: 'uid-ev',
      bolsaCuil: CUIL,
      employeeIds: ['leg-1', 'leg-1'],
    });
    assert.deepEqual(keys, [
      { field: 'uid', value: 'uid-ev' },
      { field: 'bolsaCuil', value: CUIL },
      { field: 'employeeId', value: 'leg-1' },
    ]);
  });

  it('guardia real: uid y su legajo', () => {
    const keys = consultasListenKeys({
      isPreviewMode: false,
      authUid: 'uid-g',
      employeeIds: ['emp-g'],
    });
    assert.deepEqual(keys.map((k) => k.field), ['uid', 'employeeId']);
  });
});

describe('consultaSigueAbierta', () => {
  it('PENDIENTE y AVISO_MAIL siguen; NO y vencida no', () => {
    assert.equal(consultaSigueAbierta('PENDIENTE', null, 10), true);
    assert.equal(consultaSigueAbierta('AVISO_MAIL', 50, 10), true);
    assert.equal(consultaSigueAbierta('PENDIENTE', 5, 10), false);
    assert.equal(consultaSigueAbierta('NO', null, 10), false);
    assert.equal(consultaSigueAbierta('NO_LLEGO', null, 10), false);
    assert.equal(consultaSigueAbierta('CUBIERTO', 9_000, 10), false);
    assert.equal(consultaSigueAbierta('CANCELADA', null, 10), false);
    assert.equal(consultaSigueAbierta('VENCIDA', 9_000, 10), false);
  });

  it('la línea de Alertas y el mensaje al responder no son un error crudo', () => {
    assert.equal(lineaInformativaConsulta('CUBIERTO'), 'Ya se asignó a otra persona');
    assert.equal(lineaInformativaConsulta('CONSULTA_CANCELADA'), 'Ya no hace falta');
    assert.equal(lineaInformativaConsulta('VENCIDA'), null);
    assert.equal(textoRespuestaCerrada('COMPLETA', ''), 'Ya se asignó a otra persona. ¡Gracias!');
    assert.equal(textoRespuestaCerrada('YA_RESPONDIO', 'Ya no hace falta, gracias'), 'Ya no hace falta, gracias');
    assert.equal(textoRespuestaCerrada('VENCIDA', ''), 'La consulta venció.');
    assert.equal(textoRespuestaCerrada('', ''), 'La consulta ya no está abierta.');
  });
});

describe('argsPreviewConsulta', () => {
  it('en preview manda el CUIL y el legajo; fuera no manda nada', () => {
    assert.deepEqual(argsPreviewConsulta({ isPreviewMode: true, bolsaCuil: ` ${CUIL} `, employeeId: 'emp-1' }), {
      asBolsaCuil: CUIL,
      asEmployeeId: 'emp-1',
    });
    assert.equal(argsPreviewConsulta({ isPreviewMode: false, bolsaCuil: CUIL, employeeId: 'emp-1' }), undefined);
    assert.equal(argsPreviewConsulta({ isPreviewMode: true }), undefined);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canalDeConsulta, cierreSiNadieRecibio, entregaDeConsulta, entregaTrasFcm, ENTREGA_MAIL, ENTREGA_PUSH, ENTREGA_SIN_PUSH,
  textoMailConsulta, TOOLTIP_SIN_PUSH,
} from './consultaCanal.mjs';
import { textoEstadoConsulta } from './consultaDisponibilidad.mjs';

describe('canal de la consulta', () => {
  it('sin uid igual se puede consultar: la bandeja siempre existe', () => {
    const c = canalDeConsulta({ uid: '', mail: '', pushEstado: '', tieneToken: false });
    assert.equal(c.sinCanal, false);
    assert.equal(c.puedeRecibir, true);
    assert.equal(c.sinPush, true);
    assert.equal(c.chip, null);
    assert.equal(c.codigoApp, 'SIN_UID');
    assert.equal(c.motivoApp, 'no tiene la app');
  });

  it('el mail suma y no reemplaza la bandeja', () => {
    const c = canalDeConsulta({ uid: '', mail: 'ana@bacarsa.com.ar', tieneToken: false });
    assert.equal(c.sinApp, true);
    assert.equal(c.sinPush, true);
    assert.equal(c.porMail, false);
    assert.equal(c.mail, 'ana@bacarsa.com.ar');
    assert.equal(c.puedeRecibir, true);
  });

  it('uid, token y push activo es aviso push', () => {
    const c = canalDeConsulta({ uid: 'u1', pushEstado: 'activo', tieneToken: true });
    assert.equal(c.app, true);
    assert.equal(c.sinPush, false);
    assert.equal(c.chip, null);
  });

  it('push denegado o sin token no es push', () => {
    const denegado = canalDeConsulta({ uid: 'u1', pushEstado: 'denegado', tieneToken: true });
    assert.equal(denegado.app, false);
    assert.equal(denegado.sinPush, true);
    assert.equal(denegado.motivoApp, 'permiso denegado');
    const sinToken = canalDeConsulta({ uid: 'u1', pushEstado: 'activo', tieneToken: false });
    assert.equal(sinToken.codigoApp, 'SIN_TOKEN');
    assert.equal(sinToken.sinPush, true);
  });

  it('sin pushEstado pero con token cuenta como push', () => {
    const c = canalDeConsulta({ uid: 'u1', tieneToken: true });
    assert.equal(c.app, true);
    assert.equal(c.sinPush, false);
  });

  it('en la grilla, sin mirar tokens, el uid no se marca sin push', () => {
    const c = canalDeConsulta({ uid: 'u1', mail: '' });
    assert.equal(c.sinPush, false);
    assert.equal(c.app, true);
  });

  it('la entrega es dato y no cierra por falta de app', () => {
    assert.deepEqual(entregaDeConsulta({ app: true, mailOk: true }), {
      pushEnviado: true, entregaPush: ENTREGA_PUSH, entregaMail: ENTREGA_MAIL,
    });
    assert.deepEqual(entregaDeConsulta({ app: false, mailOk: false }), {
      pushEnviado: false, entregaPush: ENTREGA_SIN_PUSH, entregaMail: null,
    });
    assert.equal(cierreSiNadieRecibio(0).cerrar, false);
    assert.equal(cierreSiNadieRecibio(0).status, 'ABIERTA');
    assert.match(textoMailConsulta('¿Podés cubrir?'), /comtroldata\.web\.app\/app/);
    assert.equal(entregaTrasFcm({ fcmOk: false }).llego, true);
    assert.equal(TOOLTIP_SIN_PUSH, 'No tiene la app instalada: lo ve al entrar a la app; si es urgente, llamalo');
  });

  it('el estado en vivo cuenta los avisos push', () => {
    const linea = textoEstadoConsulta([
      { nombre: 'Pérez, Ana', estado: 'PENDIENTE', pushEnviado: true },
      { nombre: 'ABALLAY ROLON', estado: 'PENDIENTE', pushEnviado: false },
    ]);
    assert.equal(linea, 'Consultados: 2 · 1 con aviso push');
    const solo = textoEstadoConsulta([{ nombre: 'ABALLAY ROLON', estado: 'PENDIENTE', pushEnviado: false }]);
    assert.equal(solo, 'Consultados: 1 · 0 con aviso push');
  });
});

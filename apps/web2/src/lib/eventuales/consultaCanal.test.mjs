import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canalDeConsulta, cierreSiNadieRecibio, entregaTrasFcm, textoAvisoMail, textoMailConsulta, textoNoLlego,
} from './consultaCanal.mjs';
import { textoEstadoConsulta } from './consultaDisponibilidad.mjs';

describe('canal de la consulta', () => {
  it('sin uid y sin mail no puede recibirla', () => {
    const c = canalDeConsulta({ uid: '', mail: '', pushEstado: '', tieneToken: false });
    assert.equal(c.sinCanal, true);
    assert.equal(c.chip, 'Sin app');
    assert.equal(c.motivoApp, 'no tiene la app');
    assert.equal(c.codigoApp, 'SIN_UID');
  });

  it('sin app pero con mail se avisa por mail', () => {
    const c = canalDeConsulta({ uid: '', mail: 'ana@bacarsa.com.ar', tieneToken: false });
    assert.equal(c.sinApp, true);
    assert.equal(c.porMail, true);
    assert.equal(c.sinCanal, false);
    assert.equal(c.puedeRecibir, true);
  });

  it('uid, token y push activo es la app', () => {
    const c = canalDeConsulta({ uid: 'u1', pushEstado: 'activo', tieneToken: true });
    assert.equal(c.app, true);
    assert.equal(c.chip, null);
    assert.equal(c.sinCanal, false);
  });

  it('push denegado o sin token no es la app', () => {
    const denegado = canalDeConsulta({ uid: 'u1', pushEstado: 'denegado', tieneToken: true });
    assert.equal(denegado.app, false);
    assert.equal(denegado.motivoApp, 'permiso denegado');
    const sinToken = canalDeConsulta({ uid: 'u1', pushEstado: 'activo', tieneToken: false });
    assert.equal(sinToken.codigoApp, 'SIN_TOKEN');
    assert.equal(sinToken.motivoApp, 'sin token');
  });

  it('sin pushEstado pero con token cuenta como app', () => {
    const c = canalDeConsulta({ uid: 'u1', tieneToken: true });
    assert.equal(c.app, true);
  });

  it('en la grilla, sin mirar tokens, el uid no se bloquea', () => {
    const c = canalDeConsulta({ uid: 'u1', mail: '' });
    assert.equal(c.sinCanal, false);
    assert.equal(c.app, true);
  });

  it('el texto nombra al apellido y el cierre es inmediato si nadie recibió', () => {
    assert.equal(textoNoLlego('ABALLAY ROLON', 'no tiene la app'), 'A ABALLAY no le llegó: no tiene la app');
    assert.equal(textoNoLlego('Pérez, Ana', 'sin token'), 'A Pérez no le llegó: sin token');
    assert.equal(textoAvisoMail('Pérez, Ana'), 'A Pérez le avisamos por mail: no tiene la app');
    assert.equal(cierreSiNadieRecibio(0).status, 'SIN_DESTINATARIOS');
    assert.equal(cierreSiNadieRecibio(1).cerrar, false);
    assert.match(textoMailConsulta('¿Podés cubrir?'), /comtroldata\.web\.app\/app/);
    assert.deepEqual(entregaTrasFcm({ mailOk: false, fcmOk: false }), { llego: false, motivo: 'error al enviar el aviso' });
    assert.equal(entregaTrasFcm({ mailOk: true, fcmOk: false }).llego, true);
  });

  it('el estado en vivo dice a quién no le llegó', () => {
    const linea = textoEstadoConsulta([
      { nombre: 'Pérez, Ana', estado: 'PENDIENTE' },
      { nombre: 'ABALLAY ROLON', estado: 'NO_LLEGO', motivo: 'no tiene la app' },
    ]);
    assert.equal(linea, '2 consultados · 1 pendiente · A ABALLAY no le llegó: no tiene la app');
    const solo = textoEstadoConsulta([{ nombre: 'ABALLAY ROLON', estado: 'NO_LLEGO', motivo: 'no tiene la app' }]);
    assert.match(solo, /A ABALLAY no le llegó: no tiene la app/);
    const mail = textoEstadoConsulta([{ nombre: 'Pérez, Ana', estado: 'AVISO_MAIL' }]);
    assert.match(mail, /A Pérez le avisamos por mail/);
  });
});

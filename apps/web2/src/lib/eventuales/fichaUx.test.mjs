import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  esIncompleto, faltantesConvocable, filaContacto, opcionesVigenciaMarco, planAsignarEmpresas, planImportContacto, textoEstadoMarco,
} from './fichaUx.mjs';

const hoy = '2026-10-01';
const ana = '20111111119';
const base = {
  id: ana, mail: 'ana@bacar.com', telefono: '351', domicilio: 'Calle 1',
  empresasHabilitadas: ['bacarsa'],
  credencialVencimiento: '2027-01-01',
  aptoPsicofisico: { vencimiento: '2027-01-01' },
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-09-01', vigenciaDias: 365 } },
};

describe('ficha de eventuales', () => {
  it('el estado del marco se lee en español, sin el código', () => {
    assert.deepEqual(textoEstadoMarco('MARCO_VIGENTE', '2027-09-01'), { texto: 'Vigente hasta 01/09/2027', tono: 'ok' });
    assert.deepEqual(textoEstadoMarco('SIN_MARCO', null), { texto: 'Sin contrato marco', tono: 'pendiente' });
    assert.deepEqual(textoEstadoMarco('VENCIDO', '2025-01-01'), { texto: 'Vencido', tono: 'malo' });
    assert.equal(JSON.stringify(textoEstadoMarco('SIN_MARCO', null)).includes('SIN_MARCO'), false);
    assert.equal(opcionesVigenciaMarco()[0].dias, 365);
  });

  it('chips de lo que le falta para convocarlo, y el filtro de incompletos', () => {
    assert.deepEqual(faltantesConvocable(base, hoy), []);
    assert.equal(esIncompleto(base, hoy), false);
    const incompleta = {
      ...base, mail: '', telefono: ' ', domicilio: '', empresasHabilitadas: [], marcos: {},
      credencialVencimiento: '2020-01-01', aptoPsicofisico: { vencimiento: '2020-01-01' },
    };
    assert.deepEqual(faltantesConvocable(incompleta, hoy).map((c) => c.texto), [
      'falta mail', 'falta teléfono', 'falta domicilio', 'Sin empresa habilitada', 'credencial vencida', 'apto vencido',
    ]);
    const sinMarco = { ...base, marcos: {} };
    assert.deepEqual(faltantesConvocable(sinMarco, hoy).map((c) => c.id), ['MARCO']);
    const vencido = { ...base, marcos: { bacarsa: { firmado: true, fechaFirma: '2024-01-01', vigenciaDias: 365 } } };
    assert.equal(faltantesConvocable(vencido, hoy)[0].texto, 'sin marco');
    assert.equal(esIncompleto(sinMarco, hoy), true);
  });

  it('importa contacto con dry-run: actualiza, no pisa vacíos, rechaza ajenos y mail inválido', () => {
    const cuil = '20111111112';
    const bolsa = new Map([[cuil, { mail: 'ana@bacar.com', telefono: '351', domicilio: 'Calle 1' }]]);
    const plan = planImportContacto([
      { CUIL: '20-11111111-2', Mail: 'ANA@nueva.com', Teléfono: '', Domicilio: 'Calle 9' },
      { cuil, mail: 'ana@bacar.com', telefono: '351', domicilio: 'Calle 1' },
      { cuil: '20222222223', mail: 'x@y.com' },
      { cuil: '123', mail: 'a@b.com' },
      filaContacto({ 'E-mail': 'mal', CUIT: cuil, Celular: '351', Dirección: '' }),
    ], bolsa);
    assert.deepEqual(plan.aplicar.map((d) => d.cambios), [{ mail: 'ana@nueva.com', domicilio: 'Calle 9' }]);
    assert.equal(plan.resumen.sinCambio, 1);
    assert.equal(plan.resumen.noEnBolsa, 1);
    assert.equal(plan.resumen.cuilInvalido, 1);
    assert.equal(plan.resumen.mailInvalido, 1);
    assert.equal(plan.resumen.actualizar, 1);
    const soloTel = planImportContacto([filaContacto({ cuil, celular: '351555' })], bolsa);
    assert.deepEqual(soloTel.aplicar[0].cambios, { telefono: '351555' });
  });

  it('asignar empresas solo acepta las del grupo', () => {
    assert.deepEqual(planAsignarEmpresas(['bacarsa', 'bacarsa', 'pruebas_sa']), { ok: true, empresasHabilitadas: ['bacarsa'] });
    assert.equal(planAsignarEmpresas(['pruebas_sa']).ok, false);
    assert.equal(planAsignarEmpresas([]).codigo, 'SIN_EMPRESA');
  });
});

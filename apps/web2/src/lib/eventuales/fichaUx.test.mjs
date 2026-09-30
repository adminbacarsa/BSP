import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contadoresFiltros, empresasPlataformaDeDocs, esIncompleto, faltantesConvocable, filaContacto, filtrarFichas, humanizar, iniciales,
  opcionesVigenciaMarco, planAsignarEmpresas, planHabilitarEmpresa, planImportContacto, siglaEmpresa, textoDisponibilidad, textoEstadoMarco, textoObraSocial,
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

  it('asignar y habilitar empresas: las de la plataforma si se pasan, si no las del grupo', () => {
    assert.deepEqual(planAsignarEmpresas(['bacarsa', 'bacarsa', 'pruebas_sa']), { ok: true, empresasHabilitadas: ['bacarsa'] });
    assert.equal(planAsignarEmpresas(['pruebas_sa']).ok, false);
    assert.equal(planAsignarEmpresas([]).codigo, 'SIN_EMPRESA');
    const plataforma = ['bacarsa', 'grupos_bacar_sa', 'pruebas_sa', 'capacitacion'];
    assert.deepEqual(planAsignarEmpresas(['pruebas_sa', 'otra'], plataforma).empresasHabilitadas, ['pruebas_sa']);
    assert.deepEqual(planHabilitarEmpresa(['bacarsa'], 'pruebas_sa', true, plataforma).empresasHabilitadas, ['bacarsa', 'pruebas_sa']);
    assert.deepEqual(planHabilitarEmpresa(['bacarsa', 'pruebas_sa'], 'bacarsa', false, plataforma).empresasHabilitadas, ['pruebas_sa']);
    assert.equal(planHabilitarEmpresa([], 'otra', true, plataforma).codigo, 'EMPRESA_INVALIDA');
  });

  it('la lista sigue a la empresa activa; Incompletos encuentra al que no tiene mail, teléfono, domicilio ni empresa', () => {
    const peralta = { id: '20222222223', nombre: 'PERALTA, JUAN', disponibilidad: 'DISPONIBLE', mail: '', telefono: '', domicilio: '', empresasHabilitadas: [], marcos: {} };
    const completa = base;
    const pruebas = { ...base, id: '20333333334', nombre: 'GOMEZ, LUIS', empresasHabilitadas: ['pruebas_sa'], marcos: {} };
    const noDisp = { ...base, id: '20444444445', nombre: 'DIAZ, ANA', disponibilidad: 'NO_DISPONIBLE' };
    const fichas = [peralta, completa, pruebas, noDisp];

    // Empresa activa bacarsa, sin el switch: solo habilitados ahí.
    const ids = (r) => r.map((f) => f.id).sort();
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', filtro: 'TODOS', hoy })), [base.id, noDisp.id].sort());
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', filtro: 'DISPONIBLE', hoy })), [base.id]);
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', filtro: 'NO_DISPONIBLE', hoy })), [noDisp.id]);
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', filtro: 'INCOMPLETOS', hoy })), []);

    // Toda la bolsa: Peralta aparece en Incompletos (y Gómez, sin marco en pruebas_sa).
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, filtro: 'INCOMPLETOS', hoy })), [peralta.id, pruebas.id].sort());
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, filtro: 'TODOS', hoy })), ids(fichas));
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, filtro: 'DISPONIBLE', buscar: 'peral', hoy })), [peralta.id]);
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, filtro: 'TODOS', buscar: '20333333334', hoy })), [pruebas.id]);
    // Otra empresa activa: Gómez es el habilitado.
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'pruebas_sa', filtro: 'TODOS', hoy })), [pruebas.id]);
    assert.deepEqual(ids(filtrarFichas({ fichas, empresaId: 'pruebas_sa', filtro: 'INCOMPLETOS', hoy })), [pruebas.id]);
    // Sin empresa activa (SuperAdmin sin selección): todos.
    assert.equal(filtrarFichas({ fichas, empresaId: '', filtro: 'TODOS', hoy }).length, 4);

    const contadores = contadoresFiltros({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, hoy });
    assert.deepEqual(contadores, { DISPONIBLE: 3, NO_DISPONIBLE: 1, VENCE: 0, INCOMPLETOS: 2, TODOS: 4 });
  });

  it('textos de pantalla sin ids ni códigos', () => {
    assert.equal(textoDisponibilidad('NO_DISPONIBLE'), 'No disponible');
    assert.equal(textoDisponibilidad('DISPONIBLE'), 'Disponible');
    assert.equal(humanizar('ALTA_ARCA_PENDIENTE'), 'Alta arca pendiente');
    assert.equal(iniciales('PERALTA, JUAN'), 'JP');
    assert.equal(iniciales('Ana Maria Lopez'), 'AL');
    assert.equal(siglaEmpresa('Bacar SA'), 'BA');
    assert.equal(siglaEmpresa('Grupo Bacar sa.'), 'GB');
    assert.equal(siglaEmpresa('Capacitación COSP'), 'CC');
    assert.equal(textoObraSocial('', '122807'), '122807 SUVICO (por defecto)');
    assert.equal(textoObraSocial('111-222', '122807'), '111222');
    const empresas = empresasPlataformaDeDocs([
      { id: 'pruebas_sa', data: { name: 'Pruebas sa.' } },
      { id: 'bacarsa', data: { name: 'Bacar SA', active: true } },
      { id: 'vieja', data: { name: 'Vieja', active: false } },
      { id: 'sin_nombre', data: {} },
    ]);
    assert.deepEqual(empresas, [{ id: 'bacarsa', nombre: 'Bacar SA' }, { id: 'pruebas_sa', nombre: 'Pruebas sa.' }, { id: 'sin_nombre', nombre: 'sin_nombre' }]);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checklistFicha, chipPruebas, estadoFila, FILTROS_SECUNDARIOS, PASOS_LISTO, pasosGuia, resumenBolsa, textoImprimirMarcos, textoListos, TEXTO_TODA_LA_BOLSA,
} from './listoUx.mjs';
import { filtrarFichas } from './fichaUx.mjs';

const hoy = '2026-10-02';
const lista = {
  id: '20111111119', nombre: 'PEREZ, Ana', disponibilidad: 'DISPONIBLE', mail: 'ana@bacar.com', telefono: '351', domicilio: 'Calle 1',
  empresasHabilitadas: ['bacarsa'], uid: 'uid-ana',
  credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2027-01-01' },
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-09-01', vigenciaDias: 365 } },
};
const falta = { ...lista, id: '20222222223', nombre: 'GOMEZ, Juan', mail: '', telefono: '', domicilio: '', marcos: {}, uid: '' };
const vence = { ...lista, id: '20333333334', nombre: 'LOPEZ, Eva', marcos: { bacarsa: { firmado: true, fechaFirma: '2025-10-20', vigenciaDias: 365 } } };
const baja = { ...lista, id: '20444444445', nombre: 'DIAZ, Luz', disponibilidad: 'NO_DISPONIBLE' };
const otra = { ...lista, id: '20555555556', nombre: 'RUIZ, Mia', empresasHabilitadas: ['otra'], marcos: { otra: { firmado: true, fechaFirma: '2026-09-01', vigenciaDias: 365 } }, exigirMarco: false };
const fichas = [lista, falta, vence, baja, otra];

describe('eventuales escritorio · estado en palabras', () => {
  it('una fila lista, una con lo que falta en texto y una no disponible', () => {
    assert.deepEqual(estadoFila(lista, hoy, 'bacarsa'), { tono: 'ok', texto: 'Listo para convocar', faltan: [] });
    const f = estadoFila(falta, hoy, 'bacarsa');
    assert.equal(f.tono, 'falta');
    assert.equal(f.texto, 'Falta: mail, teléfono, domicilio, contrato marco');
    assert.equal(estadoFila(baja, hoy, 'bacarsa').texto, 'No disponible');
    assert.equal(estadoFila({ ...lista, empresasHabilitadas: [] }, hoy, 'bacarsa').texto, 'Falta: empresa habilitada');
    assert.equal(estadoFila({ ...lista, credencialVencimiento: '2020-01-01' }, hoy, 'bacarsa').texto, 'Falta: credencial vigente');
  });

  it('la sigla suelta se reemplaza por el chip «Pruebas: sin exigir marco» con tooltip', () => {
    assert.equal(chipPruebas(lista), null);
    assert.equal(chipPruebas(otra).texto, 'Pruebas: sin exigir marco');
    assert.match(chipPruebas(otra).tooltip, /sin contrato marco/);
  });

  it('las 4 tarjetas-resumen cuentan sobre el alcance y ARCA viene del servidor', () => {
    const r = resumenBolsa({ fichas, empresaId: 'bacarsa', hoy, arcaPendientes: 3 });
    assert.deepEqual(r.map((t) => [t.id, t.n]), [['LISTOS', 2], ['FALTA', 1], ['MARCO_VENCE', 1], ['ARCA', 3]]);
    assert.deepEqual(r.map((t) => t.titulo), ['Listos para convocar', 'Les falta algo', 'Contrato marco por vencer', 'ARCA pendientes']);
    const grupo = resumenBolsa({ fichas, empresaId: 'bacarsa', todaLaBolsa: true, hoy });
    assert.equal(grupo.find((t) => t.id === 'LISTOS').n, 3);
    assert.equal(grupo.find((t) => t.id === 'ARCA').n, null);
  });

  it('las tarjetas y los pasos son filtros de la misma lista; Todos y No disponibles quedan en el selector', () => {
    const ids = (filtro, todaLaBolsa = false) => filtrarFichas({ fichas, empresaId: 'bacarsa', todaLaBolsa, filtro, hoy }).map((f) => f.id);
    assert.deepEqual(ids('LISTOS'), [lista.id, vence.id]);
    assert.deepEqual(ids('FALTA'), [falta.id]);
    assert.deepEqual(ids('MARCO_VENCE'), [vence.id]);
    assert.deepEqual(ids('FALTA_CONTACTO'), [falta.id]);
    assert.deepEqual(ids('FALTA_MARCO'), [falta.id]);
    assert.deepEqual(ids('FALTA_EMPRESA', true), [otra.id]);
    assert.deepEqual(ids('SIN_ACCESO'), [falta.id]);
    assert.deepEqual(ids('NO_DISPONIBLE'), [baja.id]);
    assert.equal(ids('TODOS').length, 4);
    assert.deepEqual(FILTROS_SECUNDARIOS.map((f) => f.id), ['DISPONIBLE', 'NO_DISPONIBLE', 'VENCE', 'TODOS']);
    assert.equal(TEXTO_TODA_LA_BOLSA, 'Ver también eventuales habilitados en otras empresas del grupo');
  });

  it('la guía cuenta cuántos están en cada paso', () => {
    const g = pasosGuia({ fichas, empresaId: 'bacarsa', hoy });
    assert.equal(g.disponibles, 3);
    assert.equal(g.listos, 2);
    assert.deepEqual(g.pasos.map((p) => [p.n, p.pendientes]), [[1, 1], [2, 1], [3, 0], [4, 1]]);
    assert.equal(PASOS_LISTO.map((p) => p.titulo).join(' · '), 'Datos de contacto y domicilio · Contrato marco firmado y cargado · Empresa habilitada · Acceso a la app');
    assert.equal(textoListos(g), '2 de 3 disponibles están listos para convocar.');
    assert.equal(textoListos({ listos: 0, disponibles: 0 }), 'Todavía no hay eventuales disponibles en esta empresa.');
    assert.equal(textoListos({ listos: 2, disponibles: 2 }), 'Los 2 disponibles están listos para convocar.');
  });

  it('la lista de verificación de la ficha dice hecho / falta y qué botón lo resuelve', () => {
    const ok = checklistFicha(lista, hoy, 'bacarsa', 'Bacar SA');
    assert.deepEqual(ok.map((p) => p.hecho), [true, true, true, true]);
    assert.equal(ok[1].detalle, 'Vigente hasta 01/09/2027.');
    const mal = checklistFicha(falta, hoy, 'bacarsa', 'Bacar SA');
    assert.deepEqual(mal.map((p) => p.hecho), [false, false, true, false]);
    assert.equal(mal[0].detalle, 'Falta mail, teléfono, domicilio.');
    assert.equal(mal[0].accion, 'EDITAR');
    assert.equal(mal[1].boton, 'Cargar marco');
    assert.equal(mal[3].deshabilitado, true);
    assert.match(mal[3].detalle, /Primero cargá el mail/);
    const sinEmpresa = checklistFicha({ ...lista, empresasHabilitadas: [] }, hoy, 'bacarsa', 'Bacar SA');
    assert.equal(sinEmpresa[2].hecho, false);
    assert.equal(sinEmpresa[2].boton, 'Habilitar en Bacar SA');
    assert.equal(sinEmpresa[1].detalle, 'Primero habilitá una empresa.');
    const vencido = checklistFicha({ ...lista, marcos: { bacarsa: { firmado: true, fechaFirma: '2024-01-01', vigenciaDias: 365 } } }, hoy, 'bacarsa');
    assert.equal(vencido[1].boton, 'Renovar marco');
    assert.equal(checklistFicha(vence, hoy, 'bacarsa')[1].aviso, true);
  });

  it('el botón de impresión lleva texto y cantidad', () => {
    assert.equal(textoImprimirMarcos({ pendientes: 5 }), 'Imprimir contratos marco (5)');
    assert.equal(textoImprimirMarcos({ seleccionados: 2, pendientes: 5 }), 'Imprimir contratos marco (2 seleccionados)');
  });
});

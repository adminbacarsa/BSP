import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checklistFicha, chipPruebas, estadoFila, FILTROS_SECUNDARIOS, PASOS_LISTO, pasoHoras, pasosGuia, pasoVigencias, resumenBolsa, textoImprimirMarcos, textoListos, TEXTO_TODA_LA_BOLSA,
} from './listoUx.mjs';
import { faltantesConvocable, filtrarFichas } from './fichaUx.mjs';

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
/** El caso de la captura 06/10: todo cargado menos la fecha de la credencial → Planificación lo bloquea. */
const sinFechaCredencial = { ...lista, id: '20666666667', nombre: 'ABALLAY, Ro', credencialVencimiento: '' };
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

  it('mismos criterios que el motor de candidatos: sin fecha de credencial o apto, no apto, habilitación vencida y tope', () => {
    assert.equal(estadoFila(sinFechaCredencial, hoy, 'bacarsa').texto, 'Falta: vencimiento de la credencial');
    assert.equal(estadoFila({ ...lista, aptoPsicofisico: {} }, hoy, 'bacarsa').texto, 'Falta: vencimiento del apto');
    assert.equal(estadoFila({ ...lista, aptoPsicofisico: { vencimiento: '2027-01-01', estado: 'NO_APTO' } }, hoy, 'bacarsa').texto, 'Falta: apto psicofísico (figura no apto)');
    assert.equal(estadoFila({ ...lista, aptoEstado: 'APTO' }, hoy, 'bacarsa').texto, 'Listo para convocar');
    assert.equal(estadoFila({ ...lista, habilitacion9236: { vencimiento: '2020-01-01' } }, hoy, 'bacarsa').texto, 'Falta: habilitación 9236 vigente');
    assert.equal(estadoFila({ ...lista, habilitacion9236: {} }, hoy, 'bacarsa').texto, 'Listo para convocar', 'la habilitación sin dato no bloquea, igual que el motor');
    assert.equal(estadoFila(lista, hoy, 'bacarsa', { alcanzado: true }).texto, 'Falta: horas en el mes (tope)');
    assert.equal(estadoFila(lista, hoy, 'bacarsa', { cerca: true }).texto, 'Falta: horas en el mes (tope)');
    assert.equal(estadoFila(lista, hoy, 'bacarsa', { usadas: 8, cerca: false, alcanzado: false }).texto, 'Listo para convocar');
    assert.deepEqual(faltantesConvocable({ ...falta, exigirMarco: false }, hoy, 'bacarsa').map((c) => c.id), ['MAIL', 'TEL', 'DOM'], 'con el switch de pruebas no se exige marco ni empresa');
    assert.deepEqual(faltantesConvocable({ ...lista, credencialVencimiento: '', aptoPsicofisico: { vencimiento: '2020-01-01' } }, hoy, 'bacarsa').map((c) => c.texto), [
      'credencial sin fecha de vencimiento', 'apto vencido',
    ]);
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
    const conTope = resumenBolsa({ fichas, empresaId: 'bacarsa', hoy, horasMes: { [lista.id]: { alcanzado: true } } });
    assert.deepEqual(conTope.slice(0, 2).map((t) => t.n), [1, 2], 'el tope saca de Listos y suma a Les falta algo');
  });

  it('las tarjetas y los pasos son filtros de la misma lista; Todos y No disponibles quedan en el selector', () => {
    const ids = (filtro, todaLaBolsa = false, extra = []) => filtrarFichas({ fichas: [...fichas, ...extra], empresaId: 'bacarsa', todaLaBolsa, filtro, hoy }).map((f) => f.id);
    assert.deepEqual(ids('LISTOS'), [lista.id, vence.id]);
    assert.deepEqual(ids('FALTA'), [falta.id]);
    assert.deepEqual(ids('MARCO_VENCE'), [vence.id]);
    assert.deepEqual(ids('FALTA_CONTACTO'), [falta.id]);
    assert.deepEqual(ids('FALTA_MARCO'), [falta.id]);
    assert.deepEqual(ids('FALTA_EMPRESA', true), [], 'con el switch de pruebas no se exige la empresa');
    assert.deepEqual(ids('FALTA_EMPRESA', true, [{ ...otra, id: 'x1', exigirMarco: true }]), ['x1']);
    assert.deepEqual(ids('FALTA_VIGENCIA', false, [sinFechaCredencial]), [sinFechaCredencial.id]);
    assert.deepEqual(ids('SIN_ACCESO'), [falta.id]);
    assert.deepEqual(ids('NO_DISPONIBLE'), [baja.id]);
    assert.equal(ids('TODOS').length, 4);
    assert.deepEqual(filtrarFichas({ fichas, empresaId: 'bacarsa', filtro: 'TOPE_HORAS', hoy, horasMes: { [vence.id]: { cerca: true } } }).map((f) => f.id), [vence.id]);
    assert.deepEqual(FILTROS_SECUNDARIOS.map((f) => f.id), ['DISPONIBLE', 'NO_DISPONIBLE', 'VENCE', 'TODOS']);
    assert.equal(TEXTO_TODA_LA_BOLSA, 'Ver también eventuales habilitados en otras empresas del grupo');
  });

  it('la guía cuenta cuántos están en cada paso', () => {
    const g = pasosGuia({ fichas: [...fichas, sinFechaCredencial], empresaId: 'bacarsa', hoy });
    assert.equal(g.disponibles, 4);
    assert.equal(g.listos, 2);
    assert.deepEqual(g.pasos.map((p) => [p.n, p.pendientes]), [[1, 1], [2, 1], [3, 0], [4, 1], [5, 1], [6, 0]]);
    assert.equal(PASOS_LISTO.map((p) => p.titulo).join(' · '), 'Datos de contacto y domicilio · Contrato marco firmado y cargado · Empresa habilitada · Credencial, apto y habilitación vigentes · Acceso a la app · Horas disponibles en el mes');
    assert.equal(textoListos(g), '2 de 4 disponibles están listos para convocar.');
    assert.equal(textoListos({ listos: 0, disponibles: 0 }), 'Todavía no hay eventuales disponibles en esta empresa.');
    assert.equal(textoListos({ listos: 2, disponibles: 2 }), 'Los 2 disponibles están listos para convocar.');
  });

  it('la lista de verificación de la ficha dice hecho / falta y qué botón lo resuelve', () => {
    const ok = checklistFicha(lista, hoy, 'bacarsa', 'Bacar SA');
    assert.deepEqual(ok.map((p) => p.hecho), [true, true, true, true, true, true]);
    assert.equal(ok[1].detalle, 'Vigente hasta 01/09/2027.');
    assert.equal(ok[3].detalle, 'Credencial hasta 01/01/2027 · apto hasta 01/01/2027.');
    const mal = checklistFicha(falta, hoy, 'bacarsa', 'Bacar SA');
    assert.deepEqual(mal.map((p) => p.hecho), [false, false, true, true, false, true]);
    assert.equal(mal[0].detalle, 'Falta mail, teléfono, domicilio.');
    assert.equal(mal[0].accion, 'EDITAR');
    assert.equal(mal[1].boton, 'Cargar marco');
    assert.equal(mal[4].deshabilitado, true);
    assert.match(mal[4].detalle, /Primero cargá el mail/);
    const sinEmpresa = checklistFicha({ ...lista, empresasHabilitadas: [] }, hoy, 'bacarsa', 'Bacar SA');
    assert.equal(sinEmpresa[2].hecho, false);
    assert.equal(sinEmpresa[2].boton, 'Habilitar en Bacar SA');
    assert.equal(sinEmpresa[1].detalle, 'Primero habilitá una empresa.');
    const vencido = checklistFicha({ ...lista, marcos: { bacarsa: { firmado: true, fechaFirma: '2024-01-01', vigenciaDias: 365 } } }, hoy, 'bacarsa');
    assert.equal(vencido[1].boton, 'Renovar marco');
    assert.equal(checklistFicha(vence, hoy, 'bacarsa')[1].aviso, true);
  });

  it('el paso de vigencias dice el motivo en palabras y el botón que lo resuelve (editar ficha)', () => {
    const cred = checklistFicha(sinFechaCredencial, hoy, 'bacarsa', 'Pruebas SA')[3];
    assert.equal(cred.hecho, false);
    assert.equal(cred.detalle, 'Credencial sin fecha de vencimiento.');
    assert.equal(cred.boton, 'Cargar vencimiento de credencial');
    assert.equal(cred.accion, 'EDITAR');
    assert.equal(pasoVigencias({ ...lista, aptoPsicofisico: {} }, hoy).boton, 'Cargar vencimiento del apto');
    assert.equal(pasoVigencias({ ...lista, credencialVencimiento: '2026-01-01' }, hoy).detalle, 'Credencial vencida el 01/01/2026.');
    assert.equal(pasoVigencias({ ...lista, credencialVencimiento: '2026-01-01' }, hoy).boton, 'Renovar credencial');
    assert.equal(pasoVigencias({ ...lista, aptoPsicofisico: { vencimiento: '2027-01-01', estado: 'NO_APTO' } }, hoy).detalle, 'El apto psicofísico figura como no apto.');
    const dos = pasoVigencias({ ...lista, credencialVencimiento: '', aptoPsicofisico: {} }, hoy);
    assert.equal(dos.detalle, 'Credencial sin fecha de vencimiento. Apto psicofísico sin fecha de vencimiento.');
    assert.equal(dos.boton, 'Cargar vencimientos');
    assert.equal(pasoVigencias({ ...lista, habilitacion9236: { vencimiento: '2020-05-05' } }, hoy).detalle, 'Habilitación 9236 vencida el 05/05/2020.');
    assert.equal(pasoVigencias({ ...lista, credencialVencimiento: '2026-10-20' }, hoy).aviso, true);
  });

  it('el paso de horas usa el tope de la empresa activa', () => {
    assert.deepEqual(pasoHoras(null), { hecho: true, detalle: 'Horas del mes: sin datos todavía.' });
    const tope = checklistFicha(lista, hoy, 'bacarsa', 'Bacar SA', { texto: '50/50 h este mes', alcanzado: true, cerca: true })[5];
    assert.equal(tope.hecho, false);
    assert.match(tope.detalle, /Tope del mes alcanzado \(50\/50 h este mes\)/);
    assert.equal(tope.accion, 'TOPE');
    assert.equal(pasoHoras({ texto: '48/50 h este mes', cerca: true }).detalle.startsWith('Dentro del margen del tope (48/50 h este mes)'), true);
    assert.equal(pasoHoras({ texto: '8/50 h este mes' }).detalle, '8/50 h este mes.');
  });

  it('el botón de impresión lleva texto y cantidad', () => {
    assert.equal(textoImprimirMarcos({ pendientes: 5 }), 'Imprimir contratos marco (5)');
    assert.equal(textoImprimirMarcos({ seleccionados: 2, pendientes: 5 }), 'Imprimir contratos marco (2 seleccionados)');
  });
});

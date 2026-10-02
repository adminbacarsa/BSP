/**
 * Motor ÚNICO de candidatos eventuales: `eventualesParaHueco` (packages/ops-core/src/eventoCoverage.ts,
 * espejo apps/functions/src/eventos/eventoCoverage.ts). Acá viven los casos que antes repartían
 * `evaluarCandidato` / `ordenarCandidatos` (Planificación) y el motor del CC: los dos conjuntos tienen
 * que dar lo mismo con una sola función.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as opsCore from '../../../../../packages/ops-core/src/eventoCoverage.ts';
import * as functionsCopy from '../../../../functions/src/eventos/eventoCoverage.ts';
import { ETIQUETA_PRUEBAS_SIN_MARCO } from './pruebasSwitch.mjs';
import { MOTIVO_SIN_MARCO } from './marcoAnexoConst.mjs';

const { eventualesParaHueco, evaluarEventualParaHueco, bloqueoCruceEventual, marcoEventual } = opsCore;

const aquí = path.dirname(fileURLToPath(import.meta.url));
const raíz = path.resolve(aquí, '../../../../..');

/** Jornada AR (fecha + HH:MM) → tramo en ms. Fin ≤ inicio cruza la medianoche (misma regla que el servidor). */
function tramo(j) {
  const ms = (hhmm) => Date.parse(`${j.fecha}T${hhmm.padStart(5, '0')}:00-03:00`);
  const startMs = ms(j.horaInicio);
  let endMs = ms(j.horaFin);
  if (endMs <= startMs) endMs += 24 * 3600000;
  return { startMs, endMs };
}

/** Adaptador con la firma vieja de `evaluarCandidato` para correr los casos históricos de Planificación. */
function evaluar({ bolsa, empresaId, jornadas, otrasJornadas = [], hoy, objetivoGeo = null }, motor = eventualesParaHueco) {
  const tramos = jornadas.map(tramo);
  const [r] = motor({
    bolsa: [bolsa],
    hueco: {
      empresaId,
      startMs: Math.min(...tramos.map((t) => t.startMs)),
      endMs: Math.max(...tramos.map((t) => t.endMs)),
      jornadas: tramos,
      lat: objetivoGeo?.lat ?? null,
      lng: objetivoGeo?.lng ?? null,
      hoyYmd: hoy,
    },
    otrasJornadas: otrasJornadas.map((o) => ({ cuil: bolsa.cuil, empresaId: o.empresaId, ...tramo(o) })),
    incluirNoElegibles: true,
  });
  return r;
}

const hoy = '2026-10-01';
const bolsa = {
  cuil: '20999999991', nombre: 'PEREZ, JUAN', disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['bacarsa'],
  domicilioGeo: { lat: '-31.42', lon: '-64.18' }, credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2026-10-20' },
  habilitacion9236: { vencimiento: '2027-06-01' }, confiabilidad: 90,
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-01-01', vigenciaDias: 365 } },
};
const objetivoGeo = { lat: -31.40, lng: -64.19 };
const M = { fecha: '2026-10-05', horaInicio: '07:00', horaFin: '15:00', horas: 8 };
const N = { fecha: '2026-10-05', horaInicio: '23:00', horaFin: '07:00', horas: 8 };

describe('paridad ops-core / functions', () => {
  it('el archivo es byte a byte el mismo y da el mismo resultado', () => {
    const a = fs.readFileSync(path.join(raíz, 'packages/ops-core/src/eventoCoverage.ts'), 'utf8');
    const b = fs.readFileSync(path.join(raíz, 'apps/functions/src/eventos/eventoCoverage.ts'), 'utf8');
    assert.equal(a, b);
    const casos = [
      { bolsa, empresaId: 'bacarsa', jornadas: [M], hoy, objetivoGeo },
      { bolsa, empresaId: 'bacarsa', jornadas: [M], otrasJornadas: [{ ...M, empresaId: 'grupos_bacar_sa' }], hoy },
      { bolsa: { ...bolsa, marcos: {} }, empresaId: 'bacarsa', jornadas: [M], hoy },
    ];
    for (const caso of casos) assert.deepEqual(evaluar(caso, functionsCopy.eventualesParaHueco), evaluar(caso));
  });
});

describe('casos históricos de Planificación (evaluarCandidato / ordenarCandidatos)', () => {
  it('elegible con distancia, confiabilidad y aviso de vencimiento', () => {
    const c = evaluar({ bolsa, empresaId: 'bacarsa', jornadas: [M], hoy, objetivoGeo });
    assert.equal(c.elegible, true);
    assert.ok(c.distanciaKm > 0 && c.distanciaKm < 5);
    assert.equal(c.distanceKm, c.distanciaKm);
    assert.equal(c.confiabilidad, 90);
    assert.equal(c.confiabilidadInformada, true);
    assert.deepEqual(c.alertas, ['apto vence 2026-10-20']);
    assert.equal(c.nombre, 'PEREZ, JUAN');
    assert.equal(c.employeeName, 'PEREZ, JUAN');
    assert.deepEqual(c.vencimientos.map((v) => v.estado), ['OK', 'PRONTO', 'OK']);
  });

  it('motivo visible: no habilitado, no disponible, vencido, superposición y descanso 12 h', () => {
    assert.equal(evaluar({ bolsa, empresaId: 'grupos_bacar_sa', jornadas: [M], hoy }).motivoCodigo, 'EMPRESA_NO_HABILITADA');
    assert.equal(evaluar({ bolsa: { ...bolsa, disponibilidad: 'NO_DISPONIBLE' }, empresaId: 'bacarsa', jornadas: [M], hoy }).motivoCodigo, 'NO_DISPONIBLE');
    assert.equal(evaluar({ bolsa: { ...bolsa, credencialVencimiento: '2026-09-01' }, empresaId: 'bacarsa', jornadas: [M], hoy }).motivoCodigo, 'CREDENCIAL_VENCIDA');
    assert.equal(evaluar({ bolsa: { ...bolsa, aptoPsicofisico: { vencimiento: '2026-09-01' } }, empresaId: 'bacarsa', jornadas: [M], hoy }).motivoCodigo, 'APTO_VENCIDO');
    assert.equal(evaluar({ bolsa: { ...bolsa, habilitacion9236: { vencimiento: '2026-09-01' } }, empresaId: 'bacarsa', jornadas: [M], hoy }).motivoCodigo, 'HABILITACION_VENCIDA');
    const sup = evaluar({ bolsa, empresaId: 'bacarsa', jornadas: [M], otrasJornadas: [{ ...M, empresaId: 'grupos_bacar_sa' }], hoy });
    assert.equal(sup.motivoCodigo, 'SUPERPOSICION');
    assert.match(sup.motivo, /grupos_bacar_sa/);
    assert.match(sup.motivo, /05\/10 07:00–15:00/);
    const desc = evaluar({ bolsa, empresaId: 'bacarsa', jornadas: [{ fecha: '2026-10-06', horaInicio: '08:00', horaFin: '16:00', horas: 8 }], otrasJornadas: [{ ...N, empresaId: 'grupos_bacar_sa' }], hoy });
    assert.equal(desc.motivoCodigo, 'DESCANSO_12H');
    assert.match(desc.motivo, /Faltan 1 h de descanso/);
  });

  it('ordena elegibles primero y por distancia; sin geo al final', () => {
    const lejos = { ...bolsa, cuil: '2', nombre: 'B', domicilioGeo: { lat: '-32.9', lon: '-68.8' } };
    const noHab = { ...bolsa, cuil: '3', nombre: 'A', empresasHabilitadas: [] };
    const sinGeo = { ...bolsa, cuil: '4', nombre: 'C', domicilioGeo: null };
    const t = tramo(M);
    const lista = eventualesParaHueco({
      bolsa: [noHab, sinGeo, lejos, bolsa],
      hueco: { empresaId: 'bacarsa', ...t, lat: objetivoGeo.lat, lng: objetivoGeo.lng, hoyYmd: hoy },
      incluirNoElegibles: true,
    });
    assert.deepEqual(lista.map((c) => c.cuil), ['20999999991', '2', '4', '3']);
    assert.equal(lista[2].distanciaKm, null);
  });

  it('multi-jornada: cada jornada nueva corre el cruce 12 h', () => {
    const dos = [M, { fecha: '2026-10-06', horaInicio: '07:00', horaFin: '15:00', horas: 8 }];
    assert.equal(evaluar({ bolsa, empresaId: 'bacarsa', jornadas: dos, hoy }).elegible, true);
    // La N del 5 (23–07) pisa el descanso de la M del 6, no de la M del 5.
    const r = evaluar({ bolsa, empresaId: 'bacarsa', jornadas: dos, otrasJornadas: [{ ...N, empresaId: 'otra' }], hoy });
    assert.equal(r.motivoCodigo, 'DESCANSO_12H');
    // Dos jornadas nuevas seguidas (M y T del mismo día) no se bloquean entre sí: son de la misma empresa.
    const seguidas = [M, { fecha: '2026-10-05', horaInicio: '15:00', horaFin: '23:00', horas: 8 }];
    assert.equal(evaluar({ bolsa, empresaId: 'bacarsa', jornadas: seguidas, hoy }).elegible, true);
  });
});

describe('casos históricos del switch de pruebas (pruebasSwitch)', () => {
  const hoy2 = '2026-10-02';
  const jornadas = [{ fecha: '2026-10-05', horaInicio: '08:00', horaFin: '16:00', horas: 8 }];
  const base = {
    cuil: '20111111119', nombre: 'Perez, Ana', disponibilidad: 'DISPONIBLE',
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
  };

  it('sin marco ni empresa habilitada bloquea con switch ON', () => {
    const r = evaluar({ bolsa: { ...base, empresasHabilitadas: [] }, empresaId: 'ev_emp', jornadas, hoy: hoy2 });
    assert.equal(r.elegible, false);
    assert.equal(r.motivoCodigo, 'EMPRESA_NO_HABILITADA');
    const sinMarco = evaluar({ bolsa: { ...base, empresasHabilitadas: ['ev_emp'], marcos: {} }, empresaId: 'ev_emp', jornadas, hoy: hoy2 });
    assert.equal(sinMarco.elegible, false);
    assert.equal(sinMarco.motivoCodigo, 'SIN_MARCO');
    assert.equal(sinMarco.motivo, MOTIVO_SIN_MARCO);
    assert.equal(sinMarco.pruebasSinMarco, undefined);
  });

  it('switch OFF → elegible sin marco ni empresa, marcado «Pruebas: sin exigir marco»', () => {
    const r = evaluar({ bolsa: { ...base, empresasHabilitadas: [], marcos: {}, exigirMarco: false }, empresaId: 'ev_emp', jornadas, hoy: hoy2 });
    assert.equal(r.elegible, true);
    assert.equal(r.pruebasSinMarco, true);
    assert.equal(r.motivo, null);
    assert.ok(r.alertas.includes(ETIQUETA_PRUEBAS_SIN_MARCO));
  });

  it('switch OFF sigue exigiendo credencial, apto y descanso 12 h', () => {
    const vencida = evaluar({ bolsa: { ...base, credencialVencimiento: '2026-01-01', exigirMarco: false }, empresaId: 'ev_emp', jornadas, hoy: hoy2 });
    assert.equal(vencida.elegible, false);
    assert.equal(vencida.motivoCodigo, 'CREDENCIAL_VENCIDA');
    const cruce = evaluar({
      bolsa: { ...base, exigirMarco: false }, empresaId: 'ev_emp', jornadas,
      otrasJornadas: [{ fecha: '2026-10-05', horaInicio: '00:00', horaFin: '07:00', horas: 7, empresaId: 'otra' }], hoy: hoy2,
    });
    assert.equal(cruce.elegible, false);
    assert.equal(cruce.motivoCodigo, 'DESCANSO_12H');
  });
});

describe('casos históricos del marco (marcoAnexo)', () => {
  const b = {
    cuil: '20999999991', nombre: 'PEREZ, JUAN', disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['bacarsa'],
    credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2027-01-01' },
    habilitacion9236: { vencimiento: '2027-06-01' },
    marcos: { bacarsa: { firmado: true, fechaFirma: '2026-01-01', vigenciaDias: 365 } },
  };
  const jornada = { fecha: '2026-10-05', horaInicio: '07:00', horaFin: '15:00', horas: 8 };

  it('sin marco vigente no es candidato; firmado + fecha de firma + vigencia = planMarco', () => {
    assert.equal(evaluar({ bolsa: b, empresaId: 'bacarsa', jornadas: [jornada], hoy }).elegible, true);
    const sin = evaluar({ bolsa: { ...b, marcos: {} }, empresaId: 'bacarsa', jornadas: [jornada], hoy });
    assert.equal(sin.elegible, false);
    assert.equal(sin.motivo, MOTIVO_SIN_MARCO);
    const vencido = evaluar({ bolsa: { ...b, marcos: { bacarsa: { firmado: true, fechaFirma: '2025-01-01' } } }, empresaId: 'bacarsa', jornadas: [jornada], hoy });
    assert.equal(vencido.motivo, MOTIVO_SIN_MARCO);
    assert.deepEqual(marcoEventual({ firmado: true, fechaFirma: '2026-09-10' }, hoy), { estado: 'MARCO_VIGENTE', vencimiento: '2027-09-10', avisar: false });
    assert.equal(marcoEventual({ firmado: true, fechaFirma: '2025-10-20' }, hoy).avisar, true);
    assert.equal(marcoEventual({ firmado: true, fechaFirma: '2025-09-01' }, hoy).estado, 'VENCIDO');
    assert.equal(marcoEventual({ firmado: false }, hoy).estado, 'SIN_MARCO');
    const porVencer = evaluar({ bolsa: { ...b, marcos: { bacarsa: { firmado: true, fechaFirma: '2025-10-20' } } }, empresaId: 'bacarsa', jornadas: [jornada], hoy });
    assert.ok(porVencer.alertas.includes('contrato marco vence 2026-10-20'));
  });

  it('marco del CC guardado solo con vencimiento (sin fecha de firma) sigue valiendo', () => {
    const cc = { ...b, marcos: { bacarsa: { firmado: true, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } } };
    assert.equal(evaluar({ bolsa: cc, empresaId: 'bacarsa', jornadas: [jornada], hoy }).elegible, true);
    const viejo = { ...b, marcos: { bacarsa: { firmado: true, vencimiento: '2026-09-15' } } };
    assert.equal(evaluar({ bolsa: viejo, empresaId: 'bacarsa', jornadas: [jornada], hoy }).motivoCodigo, 'SIN_MARCO');
  });
});

describe('casos históricos del CC (eventualesParaHueco)', () => {
  const start = Date.parse('2026-10-05T10:00:00.000Z');
  const end = start + 8 * 3600000;
  const hueco = { empresaId: 'ev_emp', startMs: start, endMs: end, lat: -31.42, lng: -64.19, hoyYmd: hoy };
  const ficha = (cuil, extra) => ({
    cuil, nombre: extra.nombre, disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['ev_emp'],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    domicilioGeo: extra.geo, confiabilidad: extra.confiabilidad, uid: extra.uid,
    marcos: extra.marcos === undefined ? { ev_emp: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365, vencimiento: '2027-01-15', estado: 'MARCO_VIGENTE' } } : extra.marcos,
    ...(extra.legajos ? { legajos: extra.legajos } : {}),
  });

  it('orden por distancia; el que cruza queda afuera por defecto y adentro con motivo si se pide', () => {
    const cerca = ficha('20111111119', { nombre: 'Perez, Ana', geo: { lat: -31.42, lng: -64.22 }, confiabilidad: 2, uid: 'u1', legajos: [{ empresaId: 'ev_emp', employeeId: 'leg1' }] });
    const lejos = ficha('20222222228', { nombre: 'Gomez, Luis', geo: { lat: -31.9, lng: -64.5 }, confiabilidad: 5 });
    const otras = [{ cuil: '20222222228', empresaId: 'otra', startMs: start - 2 * 3600000, endMs: start + 3600000 }];
    const cc = eventualesParaHueco({ bolsa: [lejos, cerca], hueco, otrasJornadas: otras });
    assert.deepEqual(cc.map((c) => c.cuil), ['20111111119']);
    assert.equal(cc[0].employeeId, 'leg1');
    assert.equal(cc[0].uid, 'u1');
    const todos = eventualesParaHueco({ bolsa: [lejos, cerca], hueco, otrasJornadas: otras, incluirNoElegibles: true });
    assert.deepEqual(todos.map((c) => [c.cuil, c.elegible, c.motivoCodigo]), [['20111111119', true, null], ['20222222228', false, 'SUPERPOSICION']]);
    const libres = eventualesParaHueco({ bolsa: [lejos, cerca], hueco });
    assert.deepEqual(libres.map((c) => c.cuil), ['20111111119', '20222222228']);
    assert.equal(libres[1].employeeId, '20222222228');
  });

  it('sin marco se muestra bloqueado en el CC; descanso 12 h y superposición son espejo de flujo.mjs', () => {
    const sinMarco = ficha('20333333337', { nombre: 'Sosa, Eva', geo: null, confiabilidad: 1, marcos: {} });
    const cc = eventualesParaHueco({ bolsa: [sinMarco], hueco });
    assert.equal(cc.length, 1);
    assert.equal(cc[0].elegible, false);
    assert.equal(cc[0].motivo, 'Sin contrato marco');
    assert.equal(bloqueoCruceEventual({ empresaId: 'e', startMs: start, endMs: end }, [{ empresaId: 'x', startMs: end + 3600000, endMs: end + 9 * 3600000 }]).codigo, 'DESCANSO_12H');
    assert.equal(bloqueoCruceEventual({ empresaId: 'e', startMs: start, endMs: end }, [{ empresaId: 'x', startMs: end - 3600000, endMs: end + 3600000 }]).codigo, 'SUPERPOSICION');
    assert.equal(bloqueoCruceEventual({ empresaId: 'e', startMs: start, endMs: end }, [{ empresaId: 'x', startMs: end + 12 * 3600000, endMs: end + 20 * 3600000 }]).ok, true);
    // Dos jornadas ajenas pegadas entre sí no bloquean si la nueva está lejos de ambas.
    assert.equal(bloqueoCruceEventual({ empresaId: 'e', startMs: start + 48 * 3600000, endMs: end + 48 * 3600000 }, [
      { empresaId: 'x', startMs: start - 20 * 3600000, endMs: start - 12 * 3600000 },
      { empresaId: 'y', startMs: start - 11 * 3600000, endMs: start - 3 * 3600000 },
    ]).ok, true);
  });

  it('credencial o apto sin fecha bloquean; apto «NO APTO» bloquea; apto sin estado pero vigente pasa', () => {
    const ok = ficha('20444444446', { nombre: 'Ruiz, Ana', geo: null, confiabilidad: 1 });
    assert.equal(evaluarEventualParaHueco({ ...ok, credencialVencimiento: undefined }, hueco).motivoCodigo, 'CREDENCIAL_VENCIDA');
    assert.equal(evaluarEventualParaHueco({ ...ok, aptoPsicofisico: { estado: 'APTO' } }, hueco).motivoCodigo, 'APTO_VENCIDO');
    assert.equal(evaluarEventualParaHueco({ ...ok, aptoPsicofisico: { estado: 'NO APTO', vencimiento: '2027-06-01' } }, hueco).motivoCodigo, 'NO_APTO');
    assert.equal(evaluarEventualParaHueco({ ...ok, aptoPsicofisico: { vencimiento: '2027-06-01' } }, hueco).elegible, true);
    assert.equal(evaluarEventualParaHueco({ ...ok, disponibilidad: 'NO_DISPONIBLE' }, hueco).motivoCodigo, 'NO_DISPONIBLE');
    assert.equal(evaluarEventualParaHueco({ ...ok, disponibilidad: '' }, hueco).elegible, true);
    assert.equal(eventualesParaHueco({ bolsa: [{ ...ok, disponibilidad: 'NO_DISPONIBLE' }], hueco }).length, 0);
  });

  it('desempate: distancia → confiabilidad → puntaje → nombre; sin confiabilidad informada va último', () => {
    const geo = { lat: -31.42, lng: -64.19 };
    const a = { ...ficha('1', { nombre: 'Zeta', geo, confiabilidad: 80 }), puntaje: 70 };
    const b = { ...ficha('2', { nombre: 'Alfa', geo, confiabilidad: 80 }), puntaje: 90 };
    const c = { ...ficha('3', { nombre: 'Beta', geo, confiabilidad: 95 }) };
    const d = { ...ficha('4', { nombre: 'Gama', geo }), confiabilidad: null, estadisticas: { contratos: 0 } };
    const lista = eventualesParaHueco({ bolsa: [a, d, b, c], hueco });
    assert.deepEqual(lista.map((x) => x.cuil), ['3', '2', '1', '4']);
    assert.equal(lista[3].confiabilidadInformada, false);
    assert.equal(lista[3].confiabilidad, 0);
    const e = { ...ficha('5', { nombre: 'Eme', geo }), confiabilidad: null, estadisticas: { contratos: 10, ausencias: 1 } };
    assert.equal(evaluarEventualParaHueco(e, hueco).confiabilidad, 90);
  });

  it('sin hueco válido, lista vacía', () => {
    assert.deepEqual(eventualesParaHueco(null), []);
    assert.deepEqual(eventualesParaHueco({ bolsa: [ficha('1', { nombre: 'X', geo: null })], hueco: { ...hueco, endMs: 0 } }), []);
  });
});

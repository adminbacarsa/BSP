import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bloqueAusencia,
  buscarFueraDelCronograma,
  celdaEsHuecoSla,
  clampMenuEnViewport,
  diasParaRepetir,
  marcaCeldaMenuRapido,
  opcionesMenuRapido,
  pasoDeModo,
  resumenRepetir,
  rolDesdeTurno,
  textoFranjaElegir,
  textoMarcaMenuRapido,
  textoRepetir,
  validarClicElegir,
} from './menuRapidoCobertura';

describe('opciones del menú rápido', () => {
  it('ausente con permiso: asignar, ext/adel y el modal', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'ausente');
    assert.equal(op.visible, true);
    assert.equal(op.asignar, true);
    assert.equal(op.extAdel, true);
    assert.equal(op.abrirCompleta, true);
    assert.equal(op.soloLectura, false);
  });

  it('hueco del SLA sin nadie: las mismas tres acciones', () => {
    assert.equal(celdaEsHuecoSla({ tieneTurno: false, tieneAusencia: false, faltaPaxEnPuesto: true }), true);
    assert.equal(celdaEsHuecoSla({ tieneTurno: true, tieneAusencia: false, faltaPaxEnPuesto: true }), false);
    const op = opcionesMenuRapido({ esAusente: false, esHueco: true, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'hueco');
    assert.equal(op.titulo, 'Cubrir hueco del SLA');
    assert.equal(op.asignar, true);
    assert.equal(op.extAdel, true);
    assert.equal(op.abrirCompleta, true);
  });

  it('cubierto por Operaciones: solo abrir el modal en lectura', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: true, puedeEditar: true });
    assert.equal(op.clase, 'ops');
    assert.equal(op.titulo, 'Cubierto desde Operaciones');
    assert.equal(op.asignar, false);
    assert.equal(op.extAdel, false);
    assert.equal(op.abrirCompleta, true);
    assert.equal(op.soloLectura, true);
  });

  it('sin permiso: no asigna ni parte el turno', () => {
    const op = opcionesMenuRapido({ esAusente: true, esHueco: false, cubiertoPorOps: false, puedeEditar: false });
    assert.equal(op.clase, 'sin_permiso');
    assert.equal(op.asignar, false);
    assert.equal(op.extAdel, false);
    assert.equal(op.soloLectura, true);
    assert.equal(op.abrirCompleta, true);
  });

  it('un turno laboral normal no abre el menú', () => {
    const op = opcionesMenuRapido({ esAusente: false, esHueco: false, cubiertoPorOps: false, puedeEditar: true });
    assert.equal(op.clase, 'no_aplica');
    assert.equal(op.visible, false);
  });
});

describe('franja del modo elegir', () => {
  const base = {
    clase: 'ausente' as const,
    titular: 'BAEZ, Juan',
    codigoAusencia: 'V',
    dateStr: '2026-10-08',
    banda: 'M',
    horario: '07:00–15:00',
  };

  it('Asignar a: dice a quién se cubre, el día y la franja', () => {
    assert.equal(textoFranjaElegir({ ...base, accion: 'asignar' }), 'Elegí quién cubre a BAEZ · V · 08/10 · M 07:00–15:00');
  });

  it('Ext / Adel: primero quién extiende, después quién adelanta', () => {
    assert.match(textoFranjaElegir({ ...base, accion: 'split' }), /elegí quién extiende$/);
    assert.equal(
      textoFranjaElegir({ ...base, accion: 'split', extNombre: 'GALEANO, Marta', extTramo: '07:00–11:00' }),
      'Extiende GALEANO 07:00–11:00 → ahora elegí quién adelanta',
    );
  });

  it('hueco del SLA sin titular', () => {
    assert.equal(
      textoFranjaElegir({ ...base, clase: 'hueco', titular: '', positionName: 'Puesto 1', accion: 'asignar' }),
      'Elegí quién cubre el hueco de Puesto 1 · 08/10 · M 07:00–15:00',
    );
  });

  it('el paso sigue a lo elegido', () => {
    assert.equal(pasoDeModo('asignar', ''), 'asignar');
    assert.equal(pasoDeModo('split', ''), 'ext');
    assert.equal(pasoDeModo('split', 'galeano'), 'adel');
  });
});

describe('clic en la grilla', () => {
  const ok = { puedeEditar: true, titularId: 'baez' };

  it('Asignar a: RET, ESC, REF y libre pasan', () => {
    for (const rol of ['RETEN', 'ESC', 'REF', 'FREE'] as const) {
      assert.deepEqual(validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'x', rol }), { ok: true });
    }
  });

  it('de licencia ese día: bloquea con el código', () => {
    const r = validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'x', rol: 'LICENCIA', codigoLicencia: 'E' });
    assert.deepEqual(r, { ok: false, motivo: 'De licencia ese día (E)' });
  });

  it('con turno ese día: se pisa y bloquea', () => {
    const r = validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'x', rol: 'WORKING', turnoTexto: 'M 07:00–15:00' });
    assert.deepEqual(r, { ok: false, motivo: 'Se pisa con su turno M 07:00–15:00' });
  });

  it('el franco no se asigna directo: se consulta desde el modal', () => {
    const r = validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'x', rol: 'FRANCO' });
    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /franco/);
  });

  it('el titular no se cubre a sí mismo', () => {
    const r = validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'baez', rol: 'FREE' });
    assert.deepEqual(r, { ok: false, motivo: 'Es el titular de la ausencia' });
  });

  it('descanso menor a 8 h (blocked del guard) bloquea', () => {
    const r = validarClicElegir({ ...ok, paso: 'asignar', candidatoId: 'x', rol: 'RETEN', bloqueos: ['FERRERO: descanso 6 h (mínimo 8 h)'] });
    assert.deepEqual(r, { ok: false, motivo: 'FERRERO: descanso 6 h (mínimo 8 h)' });
  });

  it('sin permiso de corrección en un mes publicado no hace nada', () => {
    const r = validarClicElegir({ puedeEditar: false, paso: 'asignar', candidatoId: 'x', rol: 'FREE' });
    assert.equal(r.ok, false);
  });

  it('Ext: tiene que tener la franja anterior al hueco', () => {
    const lista = ['galeano'];
    assert.deepEqual(validarClicElegir({ ...ok, paso: 'ext', candidatoId: 'galeano', rol: 'WORKING', candidatosBanda: lista }), { ok: true });
    const r = validarClicElegir({
      ...ok, paso: 'ext', candidatoId: 'barros', rol: 'WORKING', candidatosBanda: lista,
      inicioHueco: '15:30', finTurno: '13:30', nombreCandidato: 'BARROS',
    });
    assert.equal(r.ok, false);
    assert.match((r as { motivo: string }).motivo, /terminar entre las 15:00 y las 15:30/);
    assert.match((r as { motivo: string }).motivo, /BARROS termina 13:30/);
  });

  it('Adel: la franja siguiente y no puede ser quien extiende', () => {
    const lista = ['barros', 'galeano'];
    assert.deepEqual(validarClicElegir({ ...ok, paso: 'adel', candidatoId: 'barros', rol: 'WORKING', candidatosBanda: lista, extId: 'galeano' }), { ok: true });
    assert.deepEqual(
      validarClicElegir({ ...ok, paso: 'adel', candidatoId: 'galeano', rol: 'WORKING', candidatosBanda: lista, extId: 'galeano' }),
      { ok: false, motivo: 'Ya extiende: el adelanto lo hace otra persona' },
    );
    const r = validarClicElegir({
      ...ok, paso: 'adel', candidatoId: 'sosa', rol: 'WORKING', candidatosBanda: lista, extId: 'galeano',
      finHueco: '16:30', inicioTurno: '19:00', nombreCandidato: 'SOSA',
    });
    assert.match((r as { motivo: string }).motivo, /arrancar entre las 16:30 y las 17:00/);
    assert.match((r as { motivo: string }).motivo, /SOSA arranca 19:00/);
  });
});

describe('repetir los otros días', () => {
  const ausencia = new Set(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);

  it('el bloque son los días seguidos de la misma ausencia', () => {
    assert.deepEqual(bloqueAusencia('2026-10-08', (d) => ausencia.has(d)), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  });

  it('ofrece solo los que siguen sin cubrir', () => {
    const bloque = bloqueAusencia('2026-10-08', (d) => ausencia.has(d));
    const dias = diasParaRepetir(bloque, '2026-10-08', (d) => d === '2026-10-07');
    assert.deepEqual(dias, ['2026-10-09', '2026-10-10']);
    assert.equal(textoRepetir(dias, 'V'), 'Repetir con la misma persona los otros 2 días de V (09/10 → 10/10)');
    assert.equal(textoRepetir(['2026-10-09'], 'V'), 'Repetir con la misma persona el otro día de V (09/10)');
    assert.equal(textoRepetir([], 'V'), '');
  });

  it('lista los días que fallan y no los aplica', () => {
    const r = resumenRepetir([
      { dia: '2026-10-09', motivo: null },
      { dia: '2026-10-10', motivo: 'De licencia ese día (E)' },
    ]);
    assert.deepEqual(r.aplicados, ['2026-10-09']);
    assert.deepEqual(r.salteados, [{ dia: '2026-10-10', motivo: 'De licencia ese día (E)' }]);
    assert.equal(r.texto, 'Aplicado a 1 día. No se aplicó: 10/10 (De licencia ese día (E))');
  });
});

describe('buscar fuera del cronograma', () => {
  const personas = [
    { id: 'ret', nombre: 'GUERRERO, Marcos', rol: 'RETEN', enCronograma: true },
    { id: 'fuera', nombre: 'GALEANO, Marta', rol: 'FREE', enCronograma: false },
    { id: 'fuera-lic', nombre: 'BARROS, Luis', rol: 'LICENCIA', enCronograma: false },
    { id: 'fuera-trabaja', nombre: 'SOSA, Inés', rol: 'WORKING', enCronograma: false },
    { id: 'fuera-franco', nombre: 'GARCIA, Inés', rol: 'FRANCO', enCronograma: false },
  ];

  it('solo legajos de afuera sin turno ni licencia ese día', () => {
    assert.deepEqual(buscarFueraDelCronograma(personas).map((p) => p.id), ['fuera']);
    assert.deepEqual(buscarFueraDelCronograma(personas, 'bar').map((p) => p.id), []);
    assert.deepEqual(buscarFueraDelCronograma(personas, 'gale').map((p) => p.id), ['fuera']);
  });

  it('el rol del día coincide con el modal', () => {
    assert.equal(rolDesdeTurno(null), 'FREE');
    assert.equal(rolDesdeTurno({ code: 'RET' }), 'RETEN');
    assert.equal(rolDesdeTurno({ code: 'F', isFranco: true }), 'FRANCO');
    assert.equal(rolDesdeTurno({ code: 'L' }), 'LICENCIA');
    assert.equal(rolDesdeTurno({ code: 'M' }), 'WORKING');
  });
});

describe('marca y posición', () => {
  it('arma el tooltip de asignado y de Ext+Adel', () => {
    assert.equal(
      textoMarcaMenuRapido({
        modo: 'asignar',
        cubreA: 'ROSS, Carlos',
        tipo: 'RET',
        actor: 'Mauro',
        cuando: '08/10 09:30',
      }),
      'Cubre a ROSS · Asignado (RET) · por Mauro 08/10 09:30',
    );
    assert.equal(
      textoMarcaMenuRapido({ modo: 'split', ext: 'GALEANO, Marta', adel: 'BARROS, Luis' }),
      'Ext+Adel: GALEANO (ext) · BARROS (adel)',
    );
  });

  it('marca chica de la celda', () => {
    assert.equal(marcaCeldaMenuRapido('CUBRE', 'BAEZ, Juan'), 'BAEZ');
    assert.equal(marcaCeldaMenuRapido('EXT'), 'EXT');
    assert.equal(marcaCeldaMenuRapido('ADEL'), 'ADEL');
    assert.equal(marcaCeldaMenuRapido(null), '');
  });

  it('clampa el menú dentro de la ventana', () => {
    const pos = clampMenuEnViewport(1400, 860, 320, 220, 1440, 900);
    assert.ok(pos.left + 320 <= 1440 - 8);
    assert.ok(pos.top + 220 <= 900 - 8);
    assert.ok(pos.left >= 8);
    assert.ok(pos.top >= 8);
  });
});

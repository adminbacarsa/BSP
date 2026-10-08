import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PAUSA_ARMADO_MS,
  acumularArmado,
  proyectarArmadoEnCurso,
  registrarPublicacionArmado,
  slaMesCompleto,
  textoArmado,
  type AccionArmado,
} from './armadoCronograma';

const t0 = Date.parse('2026-10-01T13:00:00.000Z');
const min = 60 * 1000;

function accion(p: Partial<AccionArmado> = {}): AccionArmado {
  return {
    cambios: 1,
    uid: 'u1',
    nombre: 'Ana',
    origen: 'MANUAL',
    contarCorreccion: false,
    slaCompleto: false,
    ...p,
  };
}

describe('cronómetro del armado', () => {
  it('una pausa de más de 5 min no suma; una de 4 min sí, y 5 min justos también', () => {
    const inicio = acumularArmado(null, [t0], accion({ cambios: 3 }));
    assert.equal(inicio.minutosActivos, 0);
    assert.equal(inicio.iniciadoAt, new Date(t0).toISOString());

    const corto = acumularArmado(inicio, [t0 + 4 * min], accion());
    assert.equal(corto.minutosActivos, 4);

    const justo = acumularArmado(corto, [t0 + 4 * min + PAUSA_ARMADO_MS], accion());
    assert.equal(justo.minutosActivos, 9);

    const largo = acumularArmado(justo, [t0 + 4 * min + PAUSA_ARMADO_MS + PAUSA_ARMADO_MS + 1], accion());
    assert.equal(largo.minutosActivos, 9);
  });

  it('acumula sesiones y usuarios sin pisar el inicio ni el origen', () => {
    const primera = acumularArmado(null, [t0, t0 + 2 * min], accion({ uid: 'u1', nombre: 'Ana', origen: 'COPIA_MES_ANTERIOR', cambios: 8 }));
    assert.equal(primera.origen, 'COPIA_MES_ANTERIOR');
    assert.equal(primera.minutosActivos, 2);
    assert.equal(primera.cambios, 8);

    const segunda = acumularArmado(
      primera,
      [t0 + 3 * 60 * min, t0 + 3 * 60 * min + 3 * min],
      accion({ uid: 'u2', nombre: 'Beto', origen: 'MANUAL', cambios: 2 }),
    );
    assert.equal(segunda.iniciadoAt, primera.iniciadoAt);
    assert.equal(segunda.origen, 'COPIA_MES_ANTERIOR');
    assert.equal(segunda.minutosActivos, 5);
    assert.equal(segunda.cambios, 10);
    assert.deepEqual(segunda.usuarios.map((u) => u.uid), ['u1', 'u2']);

    const repetido = acumularArmado(segunda, [t0 + 3 * 60 * min + 4 * min], accion({ uid: 'u1', nombre: 'Ana' }));
    assert.equal(repetido.usuarios.length, 2);
  });

  it('el fin es el SLA completo y después no sigue el reloj', () => {
    const yendo = acumularArmado(null, [t0, t0 + 2 * min], accion({ cambios: 4 }));
    const listo = acumularArmado(yendo, [t0 + 3 * min], accion({ cambios: 1, slaCompleto: true }));
    assert.equal(listo.completadoAt, new Date(t0 + 3 * min).toISOString());
    assert.equal(listo.minutosActivos, 3);
    assert.equal(listo.minutosTranscurridos, 3);
    assert.equal(listo.cambios, 5);

    const despues = acumularArmado(listo, [t0 + 4 * min], accion({ cambios: 9, contarCorreccion: true }));
    assert.equal(despues.minutosActivos, 3);
    assert.equal(despues.cambios, 5);
    assert.equal(despues.completadoAt, listo.completadoAt);
    assert.equal(despues.correccionesPostPublicacion, 1);
  });

  it('publicar antes de completar anota la publicación y el reloj sigue hasta el SLA', () => {
    const yendo = acumularArmado(null, [t0, t0 + min], accion({ cambios: 2 }));
    const publicado = registrarPublicacionArmado(yendo, t0 + 2 * min);
    assert.ok(publicado.publicadoAt);
    assert.equal(publicado.completadoAt, null);
    assert.equal(publicado.minutosActivos, 1);

    const otraVez = registrarPublicacionArmado(publicado, t0 + 90 * min);
    assert.equal(otraVez.publicadoAt, publicado.publicadoAt);

    const sigue = acumularArmado(publicado, [t0 + 3 * min], accion({ cambios: 1, contarCorreccion: true }));
    assert.equal(sigue.completadoAt, null);
    assert.equal(sigue.minutosActivos, 3);
    assert.equal(sigue.correccionesPostPublicacion, 1);
    assert.equal(sigue.publicadoAt, publicado.publicadoAt);

    const listo = acumularArmado(sigue, [t0 + 4 * min], accion({ cambios: 1, contarCorreccion: true, slaCompleto: true }));
    assert.equal(listo.completadoAt, new Date(t0 + 4 * min).toISOString());
    assert.equal(listo.correccionesPostPublicacion, 2);
    assert.equal(listo.minutosTranscurridos, 4);
  });

  it('el texto del chip distingue en curso y armado', () => {
    const curso = acumularArmado(null, [t0], accion());
    assert.equal(textoArmado({ ...curso, minutosActivos: 18 }), 'En curso · 18 min activos');
    const listo = acumularArmado(curso, [t0 + min], accion({ slaCompleto: true }));
    assert.equal(
      textoArmado({ ...listo, minutosActivos: 42, minutosTranscurridos: 3 * 24 * 60 }),
      'Armado: 42 min activos · 3 días',
    );
    assert.equal(textoArmado(null), null);
  });

  it('la proyección en curso no cierra ni cuenta una corrección', () => {
    const curso = acumularArmado(null, [t0], accion());
    const visto = proyectarArmadoEnCurso(curso, [t0 + 2 * min]);
    assert.equal(visto?.minutosActivos, 2);
    assert.equal(visto?.completadoAt, null);
    assert.equal(visto?.correccionesPostPublicacion, 0);
    assert.equal(visto?.cambios, curso.cambios);
  });

  it('SLA completo solo cuando no quedan días abiertos ni parciales', () => {
    assert.equal(slaMesCompleto({ daysFull: 28, daysPartial: 0, daysEmpty: 0 }), true);
    assert.equal(slaMesCompleto({ daysFull: 27, daysPartial: 1, daysEmpty: 0 }), false);
    assert.equal(slaMesCompleto({ daysFull: 0, daysPartial: 0, daysEmpty: 0 }), false);
    assert.equal(slaMesCompleto(null), false);
  });
});

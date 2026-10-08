import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AVISO_MES_CERRADO,
  mesCerrado,
  puedeEditarMesPlanificacion,
  ultimoDiaMes,
} from './mesCerradoPlanif';

const HOY = new Date('2026-10-08T15:00:00-03:00');

describe('mes cerrado', () => {
  it('agosto y julio 2026 están cerrados el 8/10; octubre no', () => {
    assert.equal(ultimoDiaMes(2026, 8), '2026-08-31');
    assert.equal(mesCerrado(2026, 8, HOY), true);
    assert.equal(mesCerrado(2026, 7, HOY), true);
    assert.equal(mesCerrado(2026, 10, HOY), false);
    assert.equal(mesCerrado(2026, 9, HOY), true);
  });

  it('mes en curso se edita; publicado pide corrección', () => {
    const abierto = puedeEditarMesPlanificacion({
      year: 2026, month: 10, now: HOY, publicado: false,
      isSuperAdmin: false, correctionMode: false, puedeCorrect: false,
    });
    assert.equal(abierto.puedeEditar, true);
    assert.equal(abierto.motivo, 'abierto');

    const publicado = puedeEditarMesPlanificacion({
      year: 2026, month: 10, now: HOY, publicado: true,
      isSuperAdmin: false, correctionMode: false, puedeCorrect: true,
    });
    assert.equal(publicado.puedeEditar, false);
    assert.equal(publicado.motivo, 'publicado');

    const conCorrect = puedeEditarMesPlanificacion({
      year: 2026, month: 10, now: HOY, publicado: true,
      isSuperAdmin: false, correctionMode: true, puedeCorrect: true,
    });
    assert.equal(conCorrect.puedeEditar, true);
    assert.equal(conCorrect.motivo, 'correccion');
  });

  it('mes cerrado: el rol con correct no entra; SuperAdmin en corrección sí', () => {
    const rol = puedeEditarMesPlanificacion({
      year: 2026, month: 8, now: HOY, publicado: true,
      isSuperAdmin: false, correctionMode: true, puedeCorrect: true,
    });
    assert.equal(rol.puedeEditar, false);
    assert.equal(rol.motivo, 'mes_cerrado');
    assert.equal(AVISO_MES_CERRADO, 'Mes cerrado');

    const saSinModo = puedeEditarMesPlanificacion({
      year: 2026, month: 8, now: HOY, publicado: true,
      isSuperAdmin: true, correctionMode: false, puedeCorrect: true,
    });
    assert.equal(saSinModo.puedeEditar, false);

    const sa = puedeEditarMesPlanificacion({
      year: 2026, month: 8, now: HOY, publicado: false,
      isSuperAdmin: true, correctionMode: true, puedeCorrect: false,
    });
    assert.equal(sa.puedeEditar, true);
    assert.equal(sa.motivo, 'correccion');
  });
});

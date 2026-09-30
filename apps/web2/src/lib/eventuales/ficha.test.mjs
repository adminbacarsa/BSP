import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planAccesoEventual, planBaja, planReactivar, puedeGestionar, sugerirObraSocial, validarFicha, vencePronto } from './ficha.mjs';

const base = { nombre: 'Juan Pérez', cuil: '20-12345678-6', mail: 'juan@bacar.test', empresasHabilitadas: ['bacarsa', 'otra'] };

describe('ficha de la bolsa', () => {
  it('valida el CUIL, rechaza duplicados y deja solo empresas del grupo', () => {
    const ok = validarFicha(base, { bolsaCuils: [], plantaCuils: [] });
    assert.equal(ok.ok, true);
    assert.equal(ok.doc.empresasHabilitadas.join(','), 'bacarsa');
    assert.equal(ok.doc.disponibilidad, 'DISPONIBLE');
    assert.equal(validarFicha({ ...base, cuil: '20111111111' }).codigo, 'CUIL_INVALIDO');
    assert.equal(validarFicha(base, { bolsaCuils: [ok.doc.cuil] }).codigo, 'DUPLICADO_BOLSA');
    assert.equal(validarFicha({ ...base, cuilAnterior: ok.doc.cuil }, { bolsaCuils: [ok.doc.cuil] }).ok, true);
    assert.equal(validarFicha(base, { plantaCuils: [ok.doc.cuil] }).codigo, 'DUPLICADO_PLANTA');
  });

  it('la baja no borra y se puede reactivar', () => {
    assert.equal(planBaja('', '2026-10-01').codigo, 'SIN_MOTIVO');
    const baja = planBaja('No se presenta', '2026-10-01');
    assert.equal(baja.patch.disponibilidad, 'NO_DISPONIBLE');
    assert.equal(baja.patch.bajaBolsa.motivo, 'No se presenta');
    assert.equal(planReactivar().disponibilidad, 'DISPONIBLE');
  });

  it('el permiso y el acceso a la app', () => {
    assert.equal(puedeGestionar({ isSuperAdmin: true }, 'delete'), true);
    assert.equal(puedeGestionar({ permisos: ['read'] }, 'create'), false);
    assert.equal(puedeGestionar({ permisos: ['create'] }, 'create'), true);
    assert.equal(planAccesoEventual({ cuil: '1', mail: 'a@b.com', disponibilidad: 'DISPONIBLE' }).claims.role, 'EVENTUAL');
    assert.equal(planAccesoEventual({ cuil: '1', mail: '', disponibilidad: 'DISPONIBLE' }).codigo, 'SIN_MAIL');
    assert.equal(planAccesoEventual({ disponibilidad: 'NO_DISPONIBLE', mail: 'a@b.com' }).codigo, 'NO_DISPONIBLE');
    assert.equal(vencePronto('2026-10-15', '2026-10-01', 30), true);
    assert.equal(vencePronto('2026-12-01', '2026-10-01', 30), false);
  });

  it('sin RNOS queda pendiente y sugiere el de otro legajo', () => {
    assert.equal(validarFicha(base).doc.obraSocialRnos, '');
    const sugerida = sugerirObraSocial('', [{ empresaId: 'bacarsa', obraSocialRnos: '12.345' }]);
    assert.equal(sugerida.codigo, 'RNOS_PENDIENTE');
    assert.equal(sugerida.sugerido, true);
    assert.equal(sugerida.rnos, '012345');
    assert.equal(sugerirObraSocial('112233', [{ obraSocialRnos: '999999' }]).pendiente, false);
  });
});

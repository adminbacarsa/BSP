import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluarCandidato } from './planificacion.mjs';
import {
  canalCodigo, CUENTA_DRIVE_EVENTUALES, destinoGuardado, DRIVE_ROOT_EVENTUALES_DEFAULT, hashCodigo,
  MOTIVO_SIN_MARCO, nombreArchivo, nombreCarpetaPersona, pdfDeTexto, planConfirmarAnexo, planMarco,
  planRenombre, sha256, textoMarco,
} from './marcoAnexo.mjs';

const hoy = '2026-10-01';
const bolsa = {
  cuil: '20999999991', nombre: 'PEREZ, JUAN', disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['bacarsa'],
  credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2027-01-01' },
  habilitacion9236: { vencimiento: '2027-06-01' },
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-01-01', vigenciaDias: 365 } },
};
const jornada = { fecha: '2026-10-05', horaInicio: '07:00', horaFin: '15:00', horas: 8 };

describe('contrato marco y anexo', () => {
  it('el marco dura un año, avisa a los 30 días y vence', () => {
    const vigente = planMarco({ firmado: true, fechaFirma: '2026-09-10', hoy });
    assert.equal(vigente.estado, 'MARCO_VIGENTE');
    assert.equal(vigente.vencimiento, '2027-09-10');
    assert.equal(vigente.avisar, false);
    assert.equal(planMarco({ firmado: true, fechaFirma: '2025-10-20', hoy }).avisar, true);
    assert.equal(planMarco({ firmado: true, fechaFirma: '2025-09-01', hoy }).estado, 'VENCIDO');
    assert.equal(planMarco({ firmado: false, hoy }).estado, 'SIN_MARCO');
  });

  it('sin marco vigente no es candidato', () => {
    const ok = evaluarCandidato({ bolsa, empresaId: 'bacarsa', jornadas: [jornada], hoy });
    assert.equal(ok.elegible, true);
    const sin = evaluarCandidato({ bolsa: { ...bolsa, marcos: {} }, empresaId: 'bacarsa', jornadas: [jornada], hoy });
    assert.equal(sin.elegible, false);
    assert.equal(sin.motivo, MOTIVO_SIN_MARCO);
    const vencido = evaluarCandidato({
      bolsa: { ...bolsa, marcos: { bacarsa: { firmado: true, fechaFirma: '2025-01-01' } } },
      empresaId: 'bacarsa', jornadas: [jornada], hoy,
    });
    assert.equal(vencido.motivo, MOTIVO_SIN_MARCO);
  });

  it('el PDF del marco trae la cláusula del anexo y se guarda con hash', () => {
    const texto = textoMarco({
      empresaNombre: 'BACAR S.A.', trabajadorNombre: 'PEREZ, JUAN', trabajadorDni: '30111222', fecha: '01/10/2026',
    });
    assert.match(texto, /arts\. 99 y 100/);
    assert.match(texto, /CCT 422\/05/);
    assert.match(texto, /conformidad expresa/);
    const pdf = pdfDeTexto(texto);
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
    assert.equal(sha256(pdf).length, 64);
    assert.equal(DRIVE_ROOT_EVENTUALES_DEFAULT, '1zjzDGcAbavPaJJS5jObA0syu1SsDCakq');
    assert.equal(CUENTA_DRIVE_EVENTUALES, 'comtroldata@appspot.gserviceaccount.com');
    assert.equal(nombreCarpetaPersona({ cuil: '20999999991', nombre: 'PEREZ, JUAN' }), '20999999991 - PEREZ, JUAN');
    assert.equal(nombreCarpetaPersona({ cuil: '20999999991', nombre: 'PEREZ, JUAN', legajo: '1402' }), 'Legajo 1402 - PEREZ, JUAN - 20999999991');
    assert.equal(planRenombre('20999999991 - PEREZ, JUAN', 'Legajo 1402 - PEREZ, JUAN - 20999999991').renombrar, true);
    assert.equal(nombreArchivo({ tipo: 'MARCO', fecha: '2026-10-01', empresa: 'Bacar' }), 'Bacar-Marco-2026-10-01.pdf');
    assert.equal(nombreArchivo({ tipo: 'ANEXO', fecha: '2026-10-05', lugar: 'Peaje', empresa: 'Bacar' }), 'Bacar-Anexo-2026-10-05-Peaje.pdf');
    assert.equal(nombreArchivo({ tipo: 'ARCA', fecha: '2026-10-05', empresa: 'Bacar' }), 'Bacar-ARCA-2026-10-05.pdf');
    assert.equal(destinoGuardado(''), 'STORAGE');
    assert.equal(destinoGuardado('folder-1'), 'DRIVE');
  });

  it('el código del anexo es de un solo uso y no usa OTP de teléfono', () => {
    const salt = 's';
    const hash = hashCodigo('123456', salt);
    const ahora = 1_000;
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: false, venceMs: 2_000, ahoraMs: ahora }).ok, true);
    assert.equal(planConfirmarAnexo({ codigo: '000000', salt, hash, usado: false, venceMs: 2_000, ahoraMs: ahora }).codigo, 'CODIGO_INVALIDO');
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: true, venceMs: 2_000, ahoraMs: ahora }).codigo, 'CODIGO_USADO');
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: false, venceMs: 500, ahoraMs: ahora }).codigo, 'CODIGO_VENCIDO');
    assert.deepEqual(canalCodigo({ mail: 'a@b.com', telefono: '3515551234' }).canales, ['MAIL', 'WHATSAPP']);
    assert.equal(canalCodigo({ mail: '', telefono: '' }).codigo, 'SIN_CANAL');
  });
});

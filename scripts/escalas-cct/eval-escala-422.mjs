/**
 * Pruebas del extractor 422/05 sin red: anexo oficial con capa de texto (Disposición 120/2026) y la lectura
 * cruda de Gemini sobre el PDF escaneado de SUVICO (fixture), comparadas entre sí.
 *   node --experimental-strip-types scripts/escalas-cct/eval-escala-422.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const core = await import(`file://${resolve(dir, '../../apps/functions/src/escalas/escalaCct422Core.ts').replace(/\\/g, '/')}`);
const {
  parsearAnexoOficial422, esPropuesta, lecturaDesdeGemini, armarPropuesta422, compararPropuestas, categoriaPorLabel, CATEGORIAS_422, pesos, tablaPropuesta,
} = core;

const vig = (p, mes) => p.tramos.find((t) => t.mes === mes).categorias.find((c) => c.codigo === 'VIGILADOR');

// 1. Anexo oficial (texto): 6 tramos, 14 categorías, sumas que cierran, fuente del acto.
const textoOficial = readFileSync(join(dir, 'fixtures', 'disp-120-2026-anexo.txt'), 'utf8');
const oficial = parsearAnexoOficial422(textoOficial, { fuenteUrl: 'https://www.argentina.gob.ar/sites/default/files/infoleg/426471/disp120.pdf' });
assert.ok(esPropuesta(oficial), JSON.stringify(oficial));
assert.equal(oficial.cct, 'CCT_422_05');
assert.equal(oficial.estado, 'PROPUESTA');
assert.equal(oficial.extraccion, 'TEXTO_OFICIAL');
assert.equal(oficial.vigenciaDesde, '2026-01-01');
assert.equal(oficial.vigenciaHasta, '2026-06-30');
assert.deepEqual(oficial.tramos.map((t) => t.mes), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
for (const t of oficial.tramos) {
  assert.equal(t.categorias.length, 14, t.mes);
  assert.equal(t.mesConfianza, 'MEDIA');
  assert.equal(t.mesMotivo, 'MES_POR_POSICION');
  for (const c of t.categorias) {
    assert.equal(c.sumaCierra, true, `${t.mes} ${c.label}`);
    assert.ok(!c.codigo.startsWith('DESCONOCIDA_'), c.labelLeido);
    for (const k of ['basico', 'presentismo', 'viatico', 'noRemunerativo', 'total']) assert.equal(c[k].confianza, 'ALTA', `${t.mes} ${c.label} ${k}`);
  }
}
assert.equal(vig(oficial, '2026-01').basico.valor, 867200);
assert.equal(vig(oficial, '2026-01').codigoArca, '033104');
assert.equal(vig(oficial, '2026-06').basico.valor, 911650);
assert.equal(vig(oficial, '2026-06').total.valor, 1644650);
assert.equal(vig(oficial, '2026-06').noRemunerativo.valor, 70000);
assert.equal(oficial.tramos[0].aeroportuario.valor, 117490);
assert.equal(oficial.tramos[5].aeroportuario.valor, 123515);
assert.equal(oficial.tramos[0].adicionalVacacionesPorDia.valor, 18952);
assert.equal(oficial.tramos[3].adicionalVacacionesPorDia.valor, 19220);
assert.equal(oficial.noRemunerativoSeIncorporaAlBasicoDesde, '2026-07-01');
assert.equal(oficial.fuente.disposicion, 'DI-2026-120-APN-DNRYRT#MCH');
assert.equal(oficial.fuente.expediente, 'EX-2025-142737110-APN-DGDTEYSS#MCH');
assert.equal(oficial.fuente.documentoRE, 'RE-2025-142735643-APN-DGDTEYSS#MCH');
assert.equal(oficial.fuente.acuerdoNro, '305/26');
assert.equal(oficial.confianzaGlobal, 'MEDIA');
assert.equal(oficial.advertencias.length, 0);
assert.equal(oficial.documentoHash.length, 64);
assert.equal(parsearAnexoOficial422('   ').codigo, 'SIN_CAPA_DE_TEXTO');
assert.equal(parsearAnexoOficial422('texto largo sin convenio '.repeat(10)).codigo, 'CONVENIO_NO_RECONOCIDO');

// 2. Gemini sobre el PDF escaneado de SUVICO (lectura cruda guardada): mismas 6 tablas; los errores de OCR
//    quedan en BAJA por SUMA_NO_CIERRA y coinciden uno a uno con las diferencias contra el oficial.
const crudo = JSON.parse(readFileSync(join(dir, 'fixtures', 'suvico-ene-jun-2026.gemini.json'), 'utf8'));
const gemini = armarPropuesta422(lecturaDesdeGemini(crudo), {
  extraccion: 'GEMINI_VISION',
  documentoHash: '7af592402889'.padEnd(64, '0'),
  fuenteUrl: 'https://drive.google.com/file/d/10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc/view',
  ahora: new Date('2026-10-01T12:00:00Z'),
});
assert.equal(gemini.extraccion, 'GEMINI_VISION');
assert.equal(gemini.estado, 'PROPUESTA');
assert.deepEqual(gemini.tramos.map((t) => t.mes), oficial.tramos.map((t) => t.mes));
for (const t of gemini.tramos) assert.equal(t.categorias.length, 14, t.mes);
const difs = compararPropuestas(oficial, gemini);
const bajas = gemini.tramos.flatMap((t) => t.categorias.filter((c) => c.sumaCierra === false).map((c) => `${t.mes}/${c.codigo}`));
assert.ok(difs.length > 0 && difs.length <= 8, `diferencias ${difs.length}`);
for (const d of difs) assert.ok(bajas.includes(`${d.mes}/${d.codigo}`), `diferencia sin marcar BAJA: ${JSON.stringify(d)}`);
assert.equal(gemini.confianzaGlobal, 'BAJA');
assert.equal(vig(gemini, '2026-06').total.valor, 1644650);
assert.equal(vig(gemini, '2026-06').total.confianza, 'ALTA');
const celdas = gemini.tramos.length * 14 * 5;
console.log(`Gemini vs oficial: ${difs.length} diferencias en ${celdas} celdas; filas BAJA: ${bajas.length}`);

// 3. Normalización: confianza del modelo, mes por posición, categoría desconocida, suma no verificable.
const sintetica = armarPropuesta422(
  {
    vigenciaDesde: '2026-07-01',
    tramos: [
      { mes: null, mesLabel: null, filas: [{ categoria: 'Vigilador', basico: 950000, presentismo: 170000, viatico: 500000, noRemunerativo: 0, total: 1620000, confianza: 0.7 }] },
      { mes: null, mesLabel: 'AGOSTO', filas: [{ categoria: 'Vigilador', basico: 940000, presentismo: 170000, viatico: null, noRemunerativo: 0, total: 1620000, confianza: 0.95 }, { categoria: 'Chofer', basico: 1, presentismo: 1, viatico: 1, noRemunerativo: 1, total: 4 }] },
    ],
  },
  { extraccion: 'GEMINI_VISION', documentoHash: 'x'.repeat(64), ahora: new Date('2026-10-01T12:00:00Z') },
);
assert.deepEqual(sintetica.tramos.map((t) => t.mes), ['2026-07', '2026-08']);
assert.equal(sintetica.tramos[0].mesMotivo, 'MES_POR_POSICION');
assert.equal(sintetica.tramos[0].categorias[0].basico.confianza, 'MEDIA');
assert.equal(sintetica.tramos[1].categorias[0].viatico.motivo, 'SIN_VALOR');
assert.equal(sintetica.tramos[1].categorias[0].basico.motivo, 'BASICO_MENOR_AL_MES_ANTERIOR');
assert.ok(sintetica.tramos[1].categorias[1].codigo.startsWith('DESCONOCIDA_'));
assert.ok(sintetica.advertencias.some((a) => a.includes('Chofer')));
assert.ok(sintetica.advertencias.some((a) => a.includes('se leyeron 1 categorías')));
assert.equal(sintetica.confianzaGlobal, 'BAJA');

assert.equal(categoriaPorLabel('Controlador de admisión y permanencia gral').codigo, 'CONTROLADOR_ADMISION');
assert.equal(categoriaPorLabel('Vigilador').codigo, 'VIGILADOR');
assert.equal(categoriaPorLabel('VIGILADOR BOMBERO').codigo, 'VIGILADOR_BOMBERO');
assert.equal(categoriaPorLabel('Guia Tecnico').codigo, 'GUIA_TECNICO');
assert.equal(categoriaPorLabel('Chofer'), null);
assert.equal(CATEGORIAS_422.filter((c) => c.codigoArca).length, 1);
assert.equal(pesos('1.644.650'), 1644650);
assert.equal(pesos('$ 18.952'), 18952);
assert.equal(pesos(''), null);

writeFileSync(join(dir, 'fixtures', 'disp-120-2026.extraido.json'), JSON.stringify({ ...oficial, generadoEn: '2026-10-01T00:00:00.000Z' }, null, 2));
if (process.argv.includes('--tabla')) console.log(tablaPropuesta(gemini));
console.log('ESCALAS_CCT_422_OK', oficial.tramos.map((t) => t.mes).join(','), `oficial ${oficial.confianzaGlobal} / gemini ${gemini.confianzaGlobal}`);

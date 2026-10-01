import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extraerActaSalarial } from "./extraerActa.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const texto = readFileSync(join(dir, "fixtures", "acta-jul-dic-2026.txt"), "utf8");
const fuenteUrl = "https://upsra.org.ar/sitio/wp-content/uploads/2026/07/ACTA-SALARIAL-JUL-DIC-2026-CAESI-UPSRA-RE-2026-66453610.pdf";
const out = extraerActaSalarial(texto, { fuenteUrl });
if (!out.ok) {
  console.error(out);
  process.exit(1);
}

assert.equal(out.cct, "CCT_507_07");
assert.equal(out.distintoDe422, true);
assert.equal(out.vigenciaDesde, "2026-07-01");
assert.equal(out.vigenciaHasta, "2026-12-31");
assert.equal(out.tramos.length, 6);
assert.equal(out.noRemunerativoSeIncorporaAlBasicoDesde, "2027-01-01");

const julio = out.tramos[0];
assert.equal(julio.vigenciaDesde, "2026-07-01");
assert.equal(julio.categorias.length, 9);
assert.equal(julio.categorias.find((c) => c.codigo === "VIGILADOR_GENERAL").basicoMensual, 1001300);
assert.equal(julio.categorias.find((c) => c.codigo === "VIGILADOR_PRINCIPAL").basicoMensual, 1128000);
assert.equal(julio.noRemunerativoMensual, 20000);
assert.equal(julio.viaticoPorDia, 20220);

const octubre = out.tramos[3];
assert.equal(octubre.vigenciaDesde, "2026-10-01");
assert.equal(octubre.categorias.length, 9);
assert.equal(octubre.viaticoPorDia, 21360);

const diciembre = out.tramos[5];
assert.equal(diciembre.vigenciaDesde, "2026-12-01");
assert.equal(diciembre.categorias.find((c) => c.codigo === "VIGILADOR_GENERAL").basicoMensual, 1085000);
assert.equal(diciembre.noRemunerativoMensual, 120000);
assert.equal(diciembre.viaticoPorDia, 21800);
assert.equal(out.presentismo.find((c) => c.codigo === "VIGILADOR_GENERAL").montoMensual, 180000);
assert.equal(out.presentismo.length, 9);
assert.equal(out.documentoHash.length, 64);
assert.equal(extraerActaSalarial("   ").codigo, "SIN_CAPA_DE_TEXTO");

for (const tramo of out.tramos) assert.equal(tramo.categorias.length, 9, tramo.vigenciaDesde);

writeFileSync(join(dir, "fixtures", "acta-jul-dic-2026.extraido.json"), JSON.stringify(out, null, 2));
console.log("ESCALAS_CCT_EXTRACTOR_OK", out.cct, out.tramos.map((t) => t.vigenciaDesde).join(","));

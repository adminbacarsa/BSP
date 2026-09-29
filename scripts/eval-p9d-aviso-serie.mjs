/**
 * P9d — aviso del modal cuando el operador elige un saliente que no es el de la serie.
 *   node --experimental-strip-types scripts/eval-p9d-aviso-serie.mjs
 */
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { seriesReliefChoiceNotice } = await import(pathToFileURL(path.join(root, 'packages/ops-core/src/seriesReliefNotice.ts')).href);

const at = (h, m) => new Date(`2026-09-29T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
const shift = (id, name, code, pos, start, end) => ({
  id, employeeName: name, code, positionName: pos, shiftDateObj: start, endDateObj: end,
});

const results = [];
const report = (id, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
};

const coronel = shift('coronel', 'CORONEL', 'M', 'Puesto 1', at(7, 0), at(15, 0));
const molina = shift('molina', 'MOLINA', 'M2', 'Puesto 1', at(7, 0), at(15, 0));
const banega = shift('banega', 'BANEGA', 'T', 'Puesto 1', at(15, 0), at(23, 0));
const rio = seriesReliefChoiceNotice(banega, molina, [coronel, molina]);
report(
  'rio primero',
  rio.seriesOutgoingId === 'coronel'
    && rio.message === 'A BANEGA (T) le corresponde relevar a CORONEL (M). MOLINA (M2) cierra a su hora.',
  rio.message,
);
const serie = seriesReliefChoiceNotice(banega, coronel, [coronel, molina]);
report('preseleccion serie', serie.message === null && serie.seriesOutgoingId === 'coronel', String(serie.message));

const cardo = shift('cardo', 'CARDO', 'M2', 'Puesto 2', at(11, 45), at(15, 0));
const ferrero = shift('ferrero', 'FERRERO', 'M', 'Puesto 2', at(11, 30), at(15, 0));
const lopez = shift('lopez', 'LOPEZ', 'T', 'Puesto 2', at(15, 0), at(16, 0));
const bazan = shift('bazan', 'BAZAN', 'T2', 'Puesto 2', at(15, 30), at(16, 30));
const retiene = seriesReliefChoiceNotice(lopez, cardo, [ferrero, cardo, bazan]);
report(
  'm2 con t2 queda retenido',
  retiene.seriesOutgoingId === 'ferrero' && retiene.message === 'A LOPEZ (T) le corresponde relevar a FERRERO (M). CARDO (M2) queda retenido.',
  retiene.message,
);

const failed = results.filter((ok) => !ok).length;
console.log(`P9d ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);

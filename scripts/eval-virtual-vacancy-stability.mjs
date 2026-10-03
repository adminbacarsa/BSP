/**
 * Vacantes virtuales del CC: filtro anti-fantasma (auditoría 02/10).
 *   node --experimental-strip-types scripts/eval-virtual-vacancy-stability.mjs
 */
import { stableVirtualVacancies, VIRTUAL_VACANCY_STABLE_MS } from '../apps/web2/src/lib/operaciones/virtualVacancyStability.ts';

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

const t0 = Date.parse('2026-10-02T12:35:10-03:00');
const gap = (band) => ({ id: `gap_pruebas_sa_UJHq_puesto_1_2026-10-02_${band}`, band });
const seen = new Map();

// Snapshot desde caché: nada se dibuja aunque "falten" todas las franjas.
const cache = stableVirtualVacancies([gap('M3'), gap('T'), gap('T2')], { nowMs: t0, shiftsFromServer: false, seenAt: seen });
report('cache-no-dibuja', cache.length === 0 && seen.size === 0, `n=${cache.length}`);

// Primer cálculo con servidor: se anotan, todavía no se dibujan.
const first = stableVirtualVacancies([gap('M3'), gap('T')], { nowMs: t0, shiftsFromServer: true, seenAt: seen });
report('primera-vez-no-dibuja', first.length === 0 && seen.size === 2, `n=${first.length} seen=${seen.size}`);

// Fantasma: a los 5 s la malla vuelve completa y el hueco desaparece → se olvida.
const vanish = stableVirtualVacancies([], { nowMs: t0 + 5000, shiftsFromServer: true, seenAt: seen });
report('fantasma-se-olvida', vanish.length === 0 && seen.size === 0, `seen=${seen.size}`);

// Hueco real: persiste 60 s → se dibuja; el que reaparece después arranca de cero.
stableVirtualVacancies([gap('T3')], { nowMs: t0 + 10_000, shiftsFromServer: true, seenAt: seen });
const mid = stableVirtualVacancies([gap('T3'), gap('M3')], { nowMs: t0 + 40_000, shiftsFromServer: true, seenAt: seen });
const done = stableVirtualVacancies([gap('T3'), gap('M3')], { nowMs: t0 + 10_000 + VIRTUAL_VACANCY_STABLE_MS, shiftsFromServer: true, seenAt: seen });
report('real-se-dibuja-a-los-60s', mid.length === 0 && done.length === 1 && done[0].band === 'T3', `mid=${mid.length} done=${done.map((v) => v.band).join(',')}`);

const both = stableVirtualVacancies([gap('T3'), gap('M3')], { nowMs: t0 + 40_000 + VIRTUAL_VACANCY_STABLE_MS, shiftsFromServer: true, seenAt: seen });
report('segundo-tambien', both.length === 2, `n=${both.length}`);

// Pérdida de servidor (offline → caché): se vacía y hay que volver a estabilizar.
const offline = stableVirtualVacancies([gap('T3')], { nowMs: t0 + 200_000, shiftsFromServer: false, seenAt: seen });
const back = stableVirtualVacancies([gap('T3')], { nowMs: t0 + 201_000, shiftsFromServer: true, seenAt: seen });
report('offline-reinicia', offline.length === 0 && back.length === 0 && seen.size === 1, `off=${offline.length} back=${back.length}`);

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `${results.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);

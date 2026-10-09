/**
 * Ancho de la columna Dotación en la vista agrupada (1440×900).
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-ancho-dotacion.mjs
 */
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const { evaluate, waitFor, click, mouse, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'gp_ninos',
  clientId: 'gp_cli',
  year: 2026,
  month: 10,
  prefijo: 'ancho-dotacion',
  port: Number(process.env.CAPTURA_PORT || 3041),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9375),
  scriptInicial: `try { localStorage.removeItem('cosp-planif-ancho-dotacion:agrupada'); localStorage.removeItem('cosp-planif-ancho-dotacion:objetivo'); } catch (e) {}`,
});

const diasVisibles = `(() => {
  const g = document.querySelector('[data-plan-grilla]');
  const fila = document.getElementById('plan-emp-gp_internado');
  if (!g || !fila) return 0;
  const box = g.getBoundingClientRect();
  return [...fila.querySelectorAll('td[data-testid=grilla-celda]')].filter((td) => {
    const r = td.getBoundingClientRect();
    return r.width > 8 && r.left >= box.left - 2 && r.right <= box.right + 2;
  }).length;
})()`;

async function marcar(etiqueta) {
  const n = await evaluate(diasVisibles);
  const nombre = await evaluate(`document.querySelector('#plan-emp-gp_mixto .planning-dotacion-caja span')?.textContent || ''`);
  await evaluate(`(() => {
    let b = document.getElementById('cap-dias');
    if (!b) {
      b = document.createElement('div');
      b.id = 'cap-dias';
      b.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#111827;color:#fff;padding:8px 12px;border-radius:12px;font:700 16px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
      document.body.appendChild(b);
    }
    b.textContent = ${JSON.stringify(etiqueta)} + ' · ' + ${JSON.stringify('')} + ${n} + ' días visibles';
  })()`);
  console.log(etiqueta, n, 'días', 'nombre', nombre);
  return n;
}

await waitFor(`document.getElementById('plan-emp-gp_internado')`, 90000, 'grilla');
await sleep(800);
await click(`[...document.querySelectorAll('button')].find((b) => /niños|ninos|h\\. de/i.test(b.textContent || ''))`);
await waitFor(`[...document.querySelectorAll('button')].some((b) => /casa ronald/i.test(b.textContent || ''))`, 8000, 'menú del grupo');
await click(`[...document.querySelectorAll('button')].find((b) => /casa ronald/i.test(b.textContent || ''))`);
await waitFor(`document.querySelector('[data-fila-puesto]')`, 15000, 'chip de puesto');
await sleep(700);

await click(`document.querySelector('[data-ancho-dotacion="menu"]')`);
await click(`document.querySelector('[data-ancho-modo="ancha"]')`);
await sleep(400);
await marcar('Ancha');
await shot('ancha');

await click(`document.querySelector('[data-ancho-dotacion="menu"]')`);
await click(`document.querySelector('[data-ancho-modo="compacta"]')`);
await sleep(400);
await marcar('Compacta');
await shot('compacta');

await click(`document.querySelector('[data-ancho-dotacion="menu"]')`);
await click(`document.querySelector('[data-ancho-modo="auto"]')`);
await sleep(400);
await marcar('Auto');
await shot('auto');

const borde = await evaluate(`(() => { const el = document.querySelector('[data-ancho-dotacion="borde"]'); const r = el.getBoundingClientRect(); return { x: r.left + 1, y: r.top + r.height / 2 }; })()`);
await mouse('mousePressed', borde.x, borde.y);
await mouse('mouseMoved', borde.x - 90, borde.y);
await mouse('mouseReleased', borde.x - 90, borde.y);
await sleep(400);
await marcar('Arrastre');
await shot('arrastre');
await cerrar();

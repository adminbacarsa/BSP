/**
 * Capturas 1440x900: el tramo Ext/Adel acredita el día del hueco (Obrador, emulador 8190/9199).
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-dia-hueco.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirPlanificacion, root, shotsDir, sleep } from './planif-cdp-lib.mjs';

const MART = 't1AUNgFVeHMDv9THxaHD';
const HERRERA = 'fBJeRulBMbWda5irotFO';
const HERRANTE = 'usUePceuvfcF8gO12vHw';
const KASIAN = 'jKWkDpRenTqGyAf5ZphP';

const { send, evaluate, waitFor, mouse, click, shot, cerrar, celda } = await abrirPlanificacion({
  objectiveId: '31DrJvGnD2pRSFiusxUf',
  clientId: '99yqpqc4ppY9rVXymWhx',
  year: 2026,
  month: 10,
  prefijo: 'dia-hueco',
  port: Number(process.env.CAPTURA_PORT || 3013),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9336),
});

const nombre = (emp) => `document.getElementById('plan-emp-${emp}')?.querySelector('td,th')`;
const cobertura = (dia) => `document.querySelector('tfoot tr')?.querySelectorAll('td')[${dia}]?.innerText`;

async function ratio(dia) {
  const t = await evaluate(cobertura(dia));
  const m = String(t || '').match(/(\d+)\s*\/\s*(\d+)/);
  return { texto: String(t || '').replace(/\s+/g, ' ').trim(), ratio: m ? `${m[1]}/${m[2]}` : '' };
}

async function verDias(dias) {
  await evaluate(`(() => {
    const grid = document.querySelector('[data-plan-grilla]');
    const cell = document.querySelector('tfoot tr')?.querySelectorAll('td')[${dias[0]}];
    if (!grid || !cell) return;
    cell.scrollIntoView({ block: 'nearest', inline: 'center' });
  })()`);
  await sleep(300);
}

async function cubrir(dia, extId, adelId, etiqueta) {
  await click(celda(MART, dia), 'right');
  await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, `menú ${dia}`);
  console.log('menú', dia, await evaluate(`document.querySelector('[data-menu-rapido=raiz]')?.innerText`));
  await click(`document.querySelector('[data-menu-accion=ext]')`);
  await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, `franja ${dia}`);
  console.log('franja', etiqueta, await evaluate(`document.querySelector('[data-franja-texto]')?.innerText`));
  await click(nombre(extId));
  await sleep(700);
  console.log('tras ext', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || document.querySelector('[data-franja-aviso]')?.innerText`));
  await click(nombre(adelId));
  await sleep(900);
  const aviso = await evaluate(`document.querySelector('[data-franja-aviso]')?.innerText || ''`);
  const franja = await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || ''`);
  console.log('tras adel', franja, aviso);
  if (aviso && /no se puede|bloquea|pisa|descanso/i.test(aviso)) {
    throw new Error(`No cubrió el ${dia}: ${aviso}`);
  }
  await evaluate(`window.confirm = () => true`);
  const btn = `document.querySelector('button[title="Guardar cambios pendientes"]')`;
  await waitFor(`!!${btn}`, 8000, 'botón guardar');
  await click(btn);
  await sleep(4500);
}

async function shotNombre(name) {
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, name);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
}

async function hoverQuieto(selector, ms) {
  const p = await evaluate(`(() => {
    const el = ${selector};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  })()`);
  if (!p) throw new Error(`No está: ${selector}`);
  await mouse('mouseMoved', Math.max(8, p.x - 80), Math.max(8, p.y - 40), 'none');
  await sleep(80);
  await mouse('mouseMoved', p.x, p.y, 'none');
  await sleep(ms);
  return p;
}

try {
  await waitFor(`document.getElementById('plan-emp-${MART}')`, 90000, 'grilla con MARTINEZ');
  await sleep(1500);
  if (process.env.CAPTURA_SOLO_TOOLTIP === '1') {
    const ocultar0 = `document.querySelector('button[title="Ocultar estadísticas"]')`;
    if (await evaluate(`!!${ocultar0}`)) await click(ocultar0);
    await sleep(300);
  } else {
  const corregir = `document.querySelector('button[title^="Modo Corrección"]')`;
  if (await evaluate(`!!${corregir}`)) {
    await click(corregir);
    await sleep(500);
  }

  await verDias([10, 11, 12, 13]);
  const antes = {};
  for (const d of [10, 11, 12, 13, 14, 15]) antes[d] = await ratio(d);
  console.log('antes', antes);
  await shot('1-antes');

  await cubrir(11, HERRERA, HERRANTE, 'N11');
  await verDias([11, 12]);
  const d11 = await ratio(11);
  const d12 = await ratio(12);
  const d10 = await ratio(10);
  console.log('después del 11', { d10, d11, d12 });
  await shot('2-dia11-guardado');
  if (d11.ratio !== '2/2') throw new Error(`El 11 quedó ${d11.ratio || d11.texto}, se esperaba 2/2`);
  if (d12.ratio !== '1/2') throw new Error(`El 12 quedó ${d12.ratio || d12.texto}, se esperaba 1/2`);
  if (d10.ratio !== antes[10].ratio) throw new Error(`El 10 cambió: ${antes[10].ratio} → ${d10.ratio}`);

  const treceAntes = await ratio(13);
  await cubrir(12, HERRERA, HERRANTE, 'N12');
  await verDias([12, 13]);
  const d12b = await ratio(12);
  const d13 = await ratio(13);
  console.log('después del 12', { d12b, d13, treceAntes });
  await shot('3-dia12-guardado');
  if (d12b.ratio !== '2/2') throw new Error(`El 12 quedó ${d12b.ratio || d12b.texto}, se esperaba 2/2`);
  if (d13.ratio !== treceAntes.ratio) throw new Error(`El 13 cambió: ${treceAntes.ratio} → ${d13.ratio}`);

  const diaM = 15;
  const anterior = diaM - 1;
  const antesM = await ratio(anterior);
  await click(celda(MART, diaM), 'right');
  await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 8000, `menú ${diaM}`);
  await click(`document.querySelector('[data-menu-accion=ext]')`);
  await waitFor(`document.querySelector('[data-franja-elegir]')`, 8000, `franja M ${diaM}`);
  const franjaM = await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || ''`);
  console.log('franja M', franjaM);
  if (!/\bM\b/.test(franjaM)) throw new Error(`El ${diaM} no es un hueco M: ${franjaM}`);
  await click(nombre(KASIAN));
  await sleep(700);
  console.log('tras N anterior', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || document.querySelector('[data-franja-aviso]')?.innerText`));
  await click(nombre(HERRERA));
  await sleep(900);
  const avisoM = await evaluate(`document.querySelector('[data-franja-aviso]')?.innerText || ''`);
  console.log('tras T', await evaluate(`document.querySelector('[data-franja-texto]')?.innerText || ''`), avisoM);
  if (avisoM && /no se puede|bloquea|pisa|descanso/i.test(avisoM)) throw new Error(`No cubrió la M: ${avisoM}`);
  await evaluate(`window.confirm = () => true`);
  await click(`document.querySelector('button[title="Guardar cambios pendientes"]')`);
  await sleep(4500);
  await verDias([anterior, diaM]);
  const despuesAnt = await ratio(anterior);
  const despuesM = await ratio(diaM);
  console.log('M', { antes: antesM, anterior: despuesAnt, dia: despuesM });
  await shot('4-m-dia-anterior');
  if (despuesAnt.ratio !== antesM.ratio) throw new Error(`El día anterior a la M cambió: ${antesM.ratio} → ${despuesAnt.ratio}`);
  }

  const ocultar = `document.querySelector('button[title="Ocultar estadísticas"]')`;
  if (await evaluate(`!!${ocultar}`)) await click(ocultar);
  await sleep(400);

  await evaluate(`(() => {
    const el = ${celda(MART, 31)};
    const grid = document.querySelector('[data-plan-grilla]');
    if (!el || !grid) return;
    el.scrollIntoView({ block: 'center', inline: 'end' });
    const gr = grid.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    grid.scrollLeft += er.right - (gr.right - 6);
  })()`);
  await sleep(300);
  const celda31 = await hoverQuieto(celda(MART, 31), 2600);
  const tip31 = await evaluate(`(() => {
    const t = document.querySelector('[data-tooltip-celda]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, text: t.innerText.slice(0, 80) };
  })()`);
  console.log('tooltip 31', { celda31, tip31 });
  await shotNombre('tooltip-borde-31.png');
  if (!tip31) throw new Error('El tooltip del día 31 no apareció');
  if (tip31.left < 0 || tip31.top < 0 || tip31.right > 1440 || tip31.bottom > 900) {
    throw new Error(`Tooltip del 31 fuera de pantalla ${JSON.stringify(tip31)}`);
  }
  if (tip31.left >= celda31.left) throw new Error('El tooltip del 31 no se abrió a la izquierda de la celda');

  await mouse('mouseMoved', 20, 20, 'none');
  await sleep(300);
  const ultima = celda(HERRERA, 10);
  const puesto = await evaluate(`(() => {
    const el = ${ultima};
    const grid = document.querySelector('[data-plan-grilla]');
    if (!el || !grid) return null;
    const row = el.closest('tr');
    const gr0 = grid.getBoundingClientRect();
    const er0 = el.getBoundingClientRect();
    grid.scrollLeft += er0.left - (gr0.left + 280);
    for (const n of document.querySelectorAll('button, div, span')) {
      const t = (n.childNodes.length <= 3 ? n.textContent : '') || '';
      if (/estad[ií]sticas ocultas/i.test(t) && t.length < 40) {
        const caja = n.closest('div');
        if (caja) caja.style.display = 'none';
      }
    }
    row.parentNode.appendChild(row);
    grid.scrollTop = grid.scrollHeight;
    const foot = grid.querySelector('tfoot');
    const fr = foot ? foot.getBoundingClientRect() : null;
    let r = el.getBoundingClientRect();
    if (fr && r.bottom > fr.top - 2) {
      grid.scrollTop -= (r.bottom - (fr.top - 4));
      r = el.getBoundingClientRect();
    }
    const tope = fr ? fr.top - 8 : r.bottom - 4;
    const y = Math.min(r.top + Math.max(8, (Math.min(r.bottom, tope) - r.top) / 2), tope);
    const n = document.elementFromPoint(r.left + r.width / 2, y);
    return {
      x: r.left + r.width / 2,
      y,
      texto: el.innerText,
      top: r.top,
      bottom: r.bottom,
      pega: !!(n && (n === el || el.contains(n))),
      bajo: Math.round(window.innerHeight - r.bottom),
      footTop: fr ? Math.round(fr.top) : null,
      tag: n ? n.tagName + (n.className ? '.' + String(n.className).slice(0, 40) : '') : '',
    };
  })()`);
  console.log('celda última fila', puesto);
  if (!puesto?.pega) throw new Error('La celda de la última fila quedó tapada');
  await mouse('mouseMoved', puesto.x, Math.max(8, puesto.y - 50), 'none');
  await sleep(100);
  await mouse('mouseMoved', puesto.x, puesto.y, 'none');
  await sleep(2600);
  const celdaUlt = puesto;
  const tipUlt = await evaluate(`(() => {
    const t = document.querySelector('[data-tooltip-celda]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, text: t.innerText.slice(0, 80) };
  })()`);
  console.log('tooltip última', { celdaUlt, tipUlt });
  await shotNombre('tooltip-borde-ultima-fila.png');
  if (!tipUlt) throw new Error('El tooltip de la última fila no apareció');
  if (tipUlt.left < 0 || tipUlt.top < 0 || tipUlt.right > 1440 || tipUlt.bottom > 900) {
    throw new Error(`Tooltip de la última fila fuera de pantalla ${JSON.stringify(tipUlt)}`);
  }
  if (tipUlt.top >= celdaUlt.top) throw new Error('El tooltip de la última fila no se abrió hacia arriba');

  console.log('OK dia-hueco');
} finally {
  await cerrar();
}
void root;

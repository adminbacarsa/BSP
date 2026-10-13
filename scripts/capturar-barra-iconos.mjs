/**
 * Barra de la grilla de Planificación a 1366 px, con el modo rápido prendido.
 * BARRA_ETIQUETA=antes|despues. «despues» arma barra-iconos.png con las dos franjas (antes arriba).
 * Emulador propio: PLANIF_EMU_PORTS=8080:8391,9099:9391 (seed-padron-emulator + seed-copiar-puesto).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { abrirPlanificacion, shotsDir, sleep } from './planif-cdp-lib.mjs';

const etiqueta = process.env.BARRA_ETIQUETA || 'despues';
const ANCHO = 1366;
const ALTO_FRANJA = 170;

const p = await abrirPlanificacion({
  objectiveId: 'obj_padron', clientId: 'cli_padron', year: 2026, month: 10,
  prefijo: 'barra-iconos', port: 3036, devtoolsPort: 9366,
});
try {
  await p.send('Emulation.setDeviceMetricsOverride', { width: ANCHO, height: 768, deviceScaleFactor: 1, mobile: false });
  await p.waitFor(`document.querySelector('td[data-testid=grilla-celda]')`, 90000, 'grilla');
  await sleep(1500);
  await p.evaluate(`document.querySelector('[aria-label="Cerrar bandas faltantes"]')?.click()`);
  const prendido = await p.evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle')`);
  if (prendido !== '1') await p.click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await p.waitFor(`document.querySelector('[data-pegar-excel-abrir]')`, 10000, 'Pegar');
  await p.evaluate(`window.scrollTo(0, 0)`);
  await sleep(600);

  const medida = await p.evaluate(`(() => {
    const desborda = [];
    const vistos = new Set();
    for (const s of ['[data-modo-rapido-toggle]', '[data-importar-excel-barra]', '[data-continuar-mes]']) {
      let el = document.querySelector(s);
      while (el && el.tagName !== 'MAIN' && el !== document.body) {
        if (!vistos.has(el) && el.scrollWidth > el.clientWidth + 1) desborda.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), scroll: el.scrollWidth, client: el.clientWidth });
        vistos.add(el);
        el = el.parentElement;
      }
    }
    const sel = ['[data-importar-excel-barra]', '[data-servicio-planilla]', '[data-modo-rapido-toggle]', '[data-pegar-excel-abrir]', '[data-modo-rapido-ayuda-abrir]', '[data-continuar-mes]', '[data-importar-excel]'];
    const botones = sel.map((s) => { const b = document.querySelector(s); if (!b) return { s, falta: true }; const r = b.getBoundingClientRect(); return { s, w: Math.round(r.width), h: Math.round(r.height), derecha: Math.round(r.right), texto: (b.innerText || '').trim() }; });
    const fila = document.querySelector('[data-importar-excel-barra]')?.parentElement;
    const hijos = fila ? [...fila.children].map((h) => ({ w: Math.round(h.getBoundingClientRect().width), sw: h.scrollWidth, cls: String(h.className).slice(0, 50) })) : [];
    return { fila: fila && { w: fila.clientWidth, sw: fila.scrollWidth }, hijos, desborda, docScroll: document.documentElement.scrollWidth, ancho: window.innerWidth, botones };
  })()`);
  console.log(JSON.stringify(medida, null, 2));
  await p.evaluate(`(() => { for (const s of ['[data-importar-excel-barra]', '[data-modo-rapido-toggle]']) { let el = document.querySelector(s); while (el && el.tagName !== 'MAIN' && el !== document.body) { if (el.scrollLeft) el.scrollLeft = 0; el = el.parentElement; } } window.scrollTo(0, 0); })()`);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 740, button: 'none' });
  await sleep(500);

  const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: ANCHO, height: ALTO_FRANJA, scale: 1 } });
  const franja = join(shotsDir, `barra-iconos-${etiqueta}.png`);
  writeFileSync(franja, Buffer.from(r.data, 'base64'));
  console.log('✓', franja);

  const antes = join(shotsDir, 'barra-iconos-antes.png');
  if (etiqueta === 'despues' && existsSync(antes)) {
    const a = readFileSync(antes).toString('base64');
    const d = readFileSync(franja).toString('base64');
    const png = await p.evaluate(`(async () => {
      const cargar = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + b64; });
      const [ia, id] = await Promise.all([cargar(${JSON.stringify(a)}), cargar(${JSON.stringify(d)})]);
      const rot = 26;
      const c = document.createElement('canvas');
      c.width = ${ANCHO}; c.height = (rot + ${ALTO_FRANJA}) * 2;
      const g = c.getContext('2d');
      g.fillStyle = '#f8fafc'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#334155'; g.font = 'bold 14px system-ui, sans-serif';
      g.fillText('Antes (1366 px)', 12, 18); g.drawImage(ia, 0, rot);
      g.fillText('Después (1366 px)', 12, rot * 2 + ${ALTO_FRANJA} - 8); g.drawImage(id, 0, rot * 2 + ${ALTO_FRANJA});
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    const salida = join(shotsDir, 'barra-iconos.png');
    writeFileSync(salida, Buffer.from(png, 'base64'));
    console.log('✓', salida);
  }
} finally {
  await p.cerrar();
}

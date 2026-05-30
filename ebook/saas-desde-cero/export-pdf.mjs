/**
 * Exporta el e-book a PDF usando Puppeteer.
 * Requiere: npm install puppeteer (primera vez)
 * Uso: npm run pdf
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outPdf = join(__dir, 'SaaS-desde-Cero-Mauro-Martinez-Almeyra.pdf');

async function main() {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.log('Instalando puppeteer...');
    await new Promise((resolve, reject) => {
      const p = spawn('npm', ['install', 'puppeteer'], { cwd: __dir, shell: true, stdio: 'inherit' });
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('npm install failed'))));
    });
    puppeteer = await import('puppeteer');
  }

  const indexPath = join(__dir, 'index.html');
  if (!existsSync(indexPath)) {
    await import('./build-ebook.mjs');
  }

  const browser = await puppeteer.default.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file:///${indexPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  console.log(`✓ PDF exportado: ${outPdf}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

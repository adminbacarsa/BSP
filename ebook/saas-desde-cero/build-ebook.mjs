import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dir, 'content');

const CHAPTERS = [
  { type: 'section-opener', file: 'proxlogo.html', label: 'Prólogo', title: 'Por qué este libro existe' },
  { type: 'content', file: 'proxlogo-body.html' },
  { type: 'section-opener', file: 'intro.html', label: 'Introducción', title: 'El problema que cambió todo' },
  { type: 'content', file: 'intro-body.html' },
  { type: 'chapter-opener', file: 'cap00-opener.html', num: '00', title: 'Tu kit de IA:<br><span>herramientas y roles</span>' },
  { type: 'content', file: 'cap00.html' },
  { type: 'chapter-opener', file: 'cap01-opener.html', num: '01', title: '¿Qué es una SaaS y<br><span>por qué crear la tuya?</span>' },
  { type: 'content', file: 'cap01.html' },
  { type: 'chapter-opener', file: 'cap02-opener.html', num: '02', title: 'Definí tu idea y<br><span>elegí tu stack</span>' },
  { type: 'content', file: 'cap02.html' },
  { type: 'chapter-opener', file: 'cap03-opener.html', num: '03', title: 'Arquitectura básica<br><span>sin tecnicismos</span>' },
  { type: 'content', file: 'cap03.html' },
  { type: 'chapter-opener', file: 'cap04-opener.html', num: '04', title: '¿Dónde subir<br><span>tu SaaS?</span>' },
  { type: 'content', file: 'cap04.html' },
  { type: 'chapter-opener', file: 'cap05-opener.html', num: '05', title: 'APIs esenciales para<br><span>conectar todo</span>' },
  { type: 'content', file: 'cap05.html' },
  { type: 'chapter-opener', file: 'cap06-opener.html', num: '06', title: 'Seguridad desde<br><span>el día 1</span>' },
  { type: 'content', file: 'cap06.html' },
  { type: 'chapter-opener', file: 'cap07-opener.html', num: '07', title: 'Tu primer<br><span>piloto real</span>' },
  { type: 'content', file: 'cap07.html' },
  { type: 'chapter-opener', file: 'cap08-opener.html', num: '08', title: 'Escalar sin morir<br><span>en el intento</span>' },
  { type: 'content', file: 'cap08.html' },
  { type: 'chapter-opener', file: 'cap09-opener.html', num: '09', title: 'Los errores que cometí<br><span>y cómo evitarlos</span>' },
  { type: 'content', file: 'cap09.html' },
  { type: 'chapter-opener', file: 'cap10-opener.html', num: '10', title: 'Prompts que realmente<br><span>usé en COSP</span>' },
  { type: 'content', file: 'cap10.html' },
  { type: 'chapter-opener', file: 'cap11-opener.html', num: '11', title: 'Monetización y<br><span>distribución</span>' },
  { type: 'content', file: 'cap11.html' },
  { type: 'chapter-opener', file: 'glosario-opener.html', num: '', title: 'Glosario — <span>50 términos en lenguaje humano</span>' },
  { type: 'content', file: 'glosario.html' },
  { type: 'chapter-opener', file: 'conclusion-opener.html', num: '', title: 'Conclusión — <span>Del diagnóstico al activo digital</span>' },
  { type: 'content', file: 'conclusion.html' },
];

let pageNum = 0;

function footer(title = 'SaaS desde Cero') {
  pageNum++;
  return `<div class="page-footer"><span>${title}</span><span class="page-num">${pageNum}</span></div>`;
}

function cover() {
  return `<div class="page page-cover">
  <div class="cover-glow"></div>
  <svg class="cover-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="32" r="30" stroke="#00e5ff" stroke-width="1" opacity="0.3"/>
    <path d="M32 12 L32 52 M12 32 L52 32 M20 20 L44 44 M44 20 L20 44" stroke="#0080ff" stroke-width="0.8" opacity="0.4"/>
    <circle cx="32" cy="32" r="8" fill="#00e5ff" opacity="0.6"/>
    <circle cx="32" cy="32" r="4" fill="#00e5ff"/>
  </svg>
  <div class="cover-badge">Guía práctica para emprendedores</div>
  <h1 class="cover-title">SAAS<br>DESDE CERO</h1>
  <div class="cover-line"></div>
  <p class="cover-subtitle">De la idea al deploy: guía práctica para emprendedores</p>
  <p class="cover-author">Mauro Martinez Almeyra</p>
  <p class="cover-edition">Primera edición · 2025</p>
</div>`;
}

function toc() {
  return `<div class="page">
  <div class="section-label">Contenido</div>
  <h2 class="section-title">Índice</h2>
  <div class="content">
    <div class="toc-section">Inicio</div>
    <ul class="toc-list">
      <li><span class="num">—</span><span>Prólogo — Por qué este libro existe</span></li>
      <li><span class="num">—</span><span>Introducción — El problema que cambió todo</span></li>
    </ul>
    <div class="toc-section">Capítulos</div>
    <ul class="toc-list">
      <li><span class="num">00</span><span>Tu kit de IA: herramientas y roles</span></li>
      <li><span class="num">01</span><span>¿Qué es una SaaS y por qué crear la tuya?</span></li>
      <li><span class="num">02</span><span>Definí tu idea y elegí tu stack</span></li>
      <li><span class="num">03</span><span>Arquitectura básica sin tecnicismos</span></li>
      <li><span class="num">04</span><span>¿Dónde subir tu SaaS?</span></li>
      <li><span class="num">05</span><span>APIs esenciales para conectar todo</span></li>
      <li><span class="num">06</span><span>Seguridad desde el día 1</span></li>
      <li><span class="num">07</span><span>Tu primer piloto real</span></li>
      <li><span class="num">08</span><span>Escalar sin morir en el intento</span></li>
      <li><span class="num">09</span><span>Los errores que cometí y cómo evitarlos</span></li>
      <li><span class="num">10</span><span>Prompts que realmente usé en COSP</span></li>
      <li><span class="num">11</span><span>Monetización y distribución</span></li>
    </ul>
    <div class="toc-section">Cierre</div>
    <ul class="toc-list">
      <li><span class="num">—</span><span>Glosario — 50 términos explicados</span></li>
      <li><span class="num">—</span><span>Conclusión — Del diagnóstico al activo digital</span></li>
    </ul>
  </div>
  ${footer()}
</div>`;
}

function readContent(file) {
  const path = join(contentDir, file);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    console.warn(`Missing: ${file}`);
    return '<p><em>Contenido pendiente.</em></p>';
  }
}

function renderChapter(ch) {
  if (ch.type === 'chapter-opener') {
    const label = ch.num ? `Capítulo ${ch.num}` : '';
    return `<div class="page page-chapter-opener">
  <div class="chapter-label">${label}</div>
  <h2 class="chapter-title">${ch.title}</h2>
  ${footer()}
</div>`;
  }
  if (ch.type === 'section-opener') {
    return `<div class="page page-chapter-opener">
  <div class="chapter-label">${ch.label}</div>
  <h2 class="chapter-title">${ch.title}</h2>
  ${footer()}
</div>`;
  }
  if (ch.type === 'content') {
    const body = readContent(ch.file);
    return `<div class="content-flow"><div class="content">${body}</div></div>`;
  }
  return '';
}

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SaaS desde Cero — Mauro Martinez Almeyra</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="print-toolbar no-print">
    <button onclick="window.print()">Exportar a PDF</button>
  </div>
  ${cover()}
  ${toc()}
  ${CHAPTERS.map(renderChapter).join('\n')}
</body>
</html>`;

writeFileSync(join(__dir, 'index.html'), html, 'utf8');
console.log(`✓ index.html generado (${pageNum + 1} páginas base + contenido)`);

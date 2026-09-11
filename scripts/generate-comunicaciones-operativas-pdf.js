/**
 * Genera docs/COSP-Comunicaciones-Operativas.pdf (una sola página continua, lectura digital).
 * Uso: node scripts/generate-comunicaciones-operativas-pdf.js
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT = path.join(__dirname, '..', 'docs', 'COSP-Comunicaciones-Operativas.pdf');

const MARGIN = 44;
const PAGE_W = 595.28;
/** Altura única generosa: scroll continuo en visor PDF, sin saltos de página. */
const PAGE_H = 5200;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COL_SLATE = '#334155';
const COL_MUTED = '#64748b';
const COL_BRAND = '#4f46e5';
const COL_ROSE = '#be123c';
const COL_AMBER = '#b45309';

function sectionTitle(doc, text) {
  doc.moveDown(0.55);
  doc.fontSize(13).fillColor(COL_BRAND).font('Helvetica-Bold').text(text, MARGIN, doc.y, { width: CONTENT_W });
  doc.moveDown(0.3);
  doc.strokeColor('#c7d2fe').lineWidth(1).moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).stroke();
  doc.moveDown(0.45);
}

function paragraph(doc, text, opts = {}) {
  doc
    .fontSize(opts.size || 10)
    .fillColor(opts.color || COL_SLATE)
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(text, MARGIN, doc.y, { width: CONTENT_W, lineGap: opts.lineGap ?? 3 });
  doc.moveDown(opts.after ?? 0.4);
}

function highlightBox(doc, title, lines, style = 'indigo') {
  const palette = {
    indigo: { bg: '#eef2ff', border: '#818cf8', title: '#3730a3' },
    rose: { bg: '#fff1f2', border: '#fb7185', title: '#9f1239' },
    emerald: { bg: '#ecfdf5', border: '#34d399', title: '#065f46' },
  }[style] || { bg: '#f8fafc', border: '#cbd5e1', title: COL_SLATE };

  const pad = 12;
  const innerW = CONTENT_W - pad * 2;
  doc.fontSize(9.5).font('Helvetica');
  let h = pad + 18;
  lines.forEach((line) => {
    h += doc.heightOfString(line, { width: innerW, lineGap: 2 }) + 5;
  });
  h += pad;

  const y0 = doc.y;
  doc.roundedRect(MARGIN, y0, CONTENT_W, h, 8).fillAndStroke(palette.bg, palette.border);
  doc.fontSize(10).fillColor(palette.title).font('Helvetica-Bold').text(title, MARGIN + pad, y0 + pad, { width: innerW });
  let y = y0 + pad + 18;
  doc.font('Helvetica').fillColor(COL_SLATE).fontSize(9.5);
  lines.forEach((line) => {
    doc.text(line, MARGIN + pad, y, { width: innerW, lineGap: 2 });
    y += doc.heightOfString(line, { width: innerW, lineGap: 2 }) + 5;
  });
  doc.y = y0 + h + 12;
}

function simpleTable(doc, headers, rows, colWidths) {
  const padY = 5;
  const headerH = 24;
  let y = doc.y;

  doc.fontSize(8).font('Helvetica-Bold');
  let x = MARGIN;
  headers.forEach((h, i) => {
    doc.rect(x, y, colWidths[i], headerH).fill(COL_BRAND);
    doc.fillColor('#ffffff').text(h, x + 5, y + 7, { width: colWidths[i] - 10 });
    x += colWidths[i];
  });
  y += headerH;

  doc.font('Helvetica').fontSize(8);
  rows.forEach((row, ri) => {
    x = MARGIN;
    let rowH = 0;
    row.forEach((cell, ci) => {
      const cellH = doc.heightOfString(String(cell), { width: colWidths[ci] - 10 }) + padY * 2;
      if (cellH > rowH) rowH = cellH;
    });
    row.forEach((cell, ci) => {
      const bg = ri % 2 === 0 ? '#f8fafc' : '#ffffff';
      doc.rect(x, y, colWidths[ci], rowH).fillAndStroke(bg, '#e2e8f0');
      doc.fillColor(COL_SLATE).text(String(cell), x + 5, y + padY, { width: colWidths[ci] - 10 });
      x += colWidths[ci];
    });
    y += rowH;
  });
  doc.y = y + 12;
}

function bulletList(doc, items) {
  items.forEach((item) => {
    doc.fontSize(9.5).fillColor(COL_SLATE).font('Helvetica');
    doc.text(`•  ${item}`, MARGIN + 4, doc.y, { width: CONTENT_W - 8, lineGap: 2 });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.25);
}

function buildPdf() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: true });
  const stream = fs.createWriteStream(OUT);
  doc.pipe(stream);

  doc.rect(0, 0, PAGE_W, 132).fill(COL_BRAND);
  doc.fontSize(21).fillColor('#ffffff').font('Helvetica-Bold').text('COSP V1.0', MARGIN, 36);
  doc.fontSize(14).font('Helvetica').text('Comunicaciones operativas de la plataforma', MARGIN, 64);
  doc.fontSize(9.5).fillColor('#c7d2fe').text('Reporte de referencia · Monitoreo y Centro de Control · Lectura digital (página única)', MARGIN, 88);
  doc.fontSize(10).fillColor('#e0e7ff').text('Grupo Bacar S.A. · Documento interno · Agosto 2026', MARGIN, 106);

  doc.y = 152;

  highlightBox(
    doc,
    'Alcance — Uso operativo, no RRHH',
    [
      'Las comunicaciones descritas — incluida la futura Carpeta de Directivas Operativas — son de uso exclusivamente OPERATIVO (Monitoreo, Centro de Control, Supervisión de campo, guardias en servicio).',
      'NO reemplazan comunicaciones de RRHH: licencias, sanciones, novedades de legajo, liquidación, ART, convenio colectivo ni comunicaciones sindicales. RRHH mantiene su circuito propio en el módulo Legajos.',
    ],
    'rose',
  );

  paragraph(
    doc,
    'Este documento deja constancia de qué comunicaciones COSP registra formalmente, cuáles tienen trazabilidad parcial, qué queda fuera de la plataforma y cómo se resuelve cada caso.',
  );

  sectionTitle(doc, '1. Principio rector');
  paragraph(
    doc,
    'COSP es el registro oficial y trazable de lo operativo. WhatsApp y llamadas pueden seguir como complemento humano, pero sin respaldo en plataforma salvo registro manual.',
  );
  highlightBox(
    doc,
    'Tres circuitos',
    [
      'Informal (WhatsApp / llamada): sin trazabilidad COSP.',
      'Operativo (COSP): registro formal con fecha, autor y acuse cuando corresponde.',
      'RRHH (módulo Legajos): novedades laborales — fuera de este reporte.',
    ],
    'indigo',
  );

  sectionTitle(doc, '2. Leyenda');
  simpleTable(
    doc,
    ['Estado', 'Significado'],
    [
      ['Completo', 'Registro formal con fecha, autor e historial'],
      ['Parcial', 'Trazabilidad incompleta'],
      ['Externo', 'Canal manual fuera de COSP'],
      ['Pendiente', 'Aún no desarrollado'],
    ],
    [100, CONTENT_W - 100],
  );

  sectionTitle(doc, '3. Centro de Monitoreo');
  simpleTable(
    doc,
    ['Tipo', 'Registro', 'Acuse', 'Estado'],
    [
      ['Novedades (vacante, ausencia, retención)', 'novedades + auditoría', 'Parcial', 'Completo'],
      ['Presencia / cobertura / baja', 'turnos + audit_logs', 'N/A', 'Completo'],
      ['Escalado automático (AUTO_T30)', 'novedades + sistema', 'N/A', 'Completo'],
      ['WhatsApp desde Operaciones', 'Sin registro', 'No', 'Externo'],
      ['Directivas operativas formales', 'Sin módulo', 'No', 'Pendiente'],
    ],
    [150, 145, 65, CONTENT_W - 360],
  );
  paragraph(
    doc,
    'Gap principal: directivas de Monitoreo hoy van por WhatsApp. Consignas (Supervisión) cubren instrucciones estables del puesto, no directivas puntuales a dotación.',
    { size: 9, color: COL_MUTED },
  );

  sectionTitle(doc, '4. Comunicaciones al guardia');
  simpleTable(
    doc,
    ['Tipo', 'Registro', 'Push', 'Acuse', 'Estado'],
    [
      ['Cambio cronograma / turno', 'notificaciones + turnos', 'Sí', 'Parcial web / Sí app', 'Parcial'],
      ['Publicación planificación', 'planificacion_estados', 'Sí', 'Parcial', 'Parcial'],
      ['Convocatoria evento', 'eventos', 'Sí', 'Sí app', 'Parcial'],
      ['Retención / adelanto / FT', 'novedades', 'Parcial', 'Parcial', 'Parcial'],
      ['Permuta', 'swap_requests', 'Sí', 'Completo', 'Completo'],
    ],
    [125, 125, 42, 75, CONTENT_W - 367],
  );
  paragraph(
    doc,
    'Licencias, enfermedad y vacaciones = circuito RRHH, no operativo de Monitoreo.',
    { size: 9, color: COL_AMBER, bold: true },
  );

  sectionTitle(doc, '5. Supervisión de campo');
  simpleTable(
    doc,
    ['Tipo', 'Registro', 'Acuse', 'Estado'],
    [
      ['Consignas por objetivo', 'objetivo_consignas', 'Lectura registrada', 'Completo'],
      ['Libro de guardia', 'libro_guardia', 'Unilateral', 'Completo'],
      ['Visita supervisión', 'supervision_visitas', 'N/A', 'Completo'],
      ['Solicitud refuerzo', 'solicitudes_refuerzo', 'Workflow', 'Completo'],
    ],
    [135, 145, 105, CONTENT_W - 385],
  );

  sectionTitle(doc, '6. Canales auxiliares');
  simpleTable(
    doc,
    ['Canal', 'Uso', 'Trazabilidad', 'Resolución externa'],
    [
      ['WhatsApp', 'Contacto manual', 'Ninguna', 'Chat operador'],
      ['Email', 'Alta portal', 'Invite', 'Sin alertas ops'],
      ['Push FCM', 'Alertas críticas', 'Copia en bandeja', 'Sin token: UI web'],
      ['Asistente IA', 'Consultas admin', 'Log consultas', 'No comunica guardia'],
    ],
    [105, 125, 105, CONTENT_W - 335],
  );

  sectionTitle(doc, '7. Lo que COSP registra formalmente hoy');
  bulletList(doc, [
    'Hechos operativos: presencia, ausencia, cobertura, retención, vacante (turnos + audit_logs).',
    'Alertas del monitor y del sistema (novedades).',
    'Consignas con acuse de lectura.',
    'Refuerzos y permutas con workflow.',
    'Visitas de supervisión y libro de guardia.',
    'Planificación publicada con historial.',
  ]);

  sectionTitle(doc, '8. Brechas vs. solicitud Monitoreo');
  simpleTable(
    doc,
    ['Requerimiento', 'Hoy', 'Alternativa', 'Futuro'],
    [
      ['Directivas formales', 'No', 'WhatsApp', 'Módulo Directivas'],
      ['Fecha/hora comunicación', 'Parcial', 'Chat WA', 'communicatedAt'],
      ['Seguimiento cumplimiento', 'Parcial', 'Manual', 'Estados + acuse'],
      ['Historial ordenado', 'Disperso', 'WA + planillas', 'Carpeta unificada'],
      ['Evitar dispersión WA', 'No', 'Grupos WA', 'COSP oficial'],
      ['Respaldo reclamos', 'Hechos sí', 'Chats WA', 'Export PDF'],
    ],
    [130, 55, 115, CONTENT_W - 300],
  );

  sectionTitle(doc, '9. Lo que COSP no hace');
  simpleTable(
    doc,
    ['Necesidad', 'Resolución actual', 'Riesgo'],
    [
      ['Grupos WhatsApp ops', 'Grupos por zona', 'Sin prueba formal'],
      ['Directivas a dotación', 'WA + reunión', 'Sin trazabilidad'],
      ['Comunicaciones RRHH', 'Módulo RRHH + externo', 'Fuera alcance ops'],
      ['Email alertas ops', 'Push / manual', 'Guardia sin app'],
    ],
    [155, 195, CONTENT_W - 350],
  );

  sectionTitle(doc, '10. Conclusión');
  highlightBox(
    doc,
    'Síntesis',
    [
      'COSP registra bien hechos operativos y workflows formales.',
      'No es aún repositorio de directivas de Monitoreo ni sustituto de WhatsApp.',
      'La Carpeta de Directivas Operativas sería módulo OPERATIVO nuevo.',
      'RRHH permanece en su módulo; no confundir con alertas de Monitoreo.',
    ],
    'emerald',
  );

  doc.moveDown(0.6);
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + CONTENT_W, doc.y)
    .stroke();
  doc.moveDown(0.5);
  doc.fontSize(8).fillColor(COL_MUTED).font('Helvetica').text(
    'COSP V1.0 · Comunicaciones operativas · Grupo Bacar S.A. · Documento interno · Versión lectura digital',
    MARGIN,
    doc.y,
    { width: CONTENT_W, align: 'center' },
  );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      console.log(`PDF generado (página única): ${OUT}`);
      resolve(OUT);
    });
    stream.on('error', reject);
  });
}

buildPdf().catch((err) => {
  console.error(err);
  process.exit(1);
});

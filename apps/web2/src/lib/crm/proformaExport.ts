import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { ProformaExportBundle, ProformaObjectiveGrid, ProformaEvento, ProformaPositionObjectiveGrid, ProformaLayoutMode } from './proformaTypes';
import { formatHoursColonTotal, pdfDayLetter, pdfDayNumber, shortDayHeader } from './proformaGrid';

const PDF_PAGE_W = 297;
const PDF_MARGIN_X = 8;
const PDF_HEADER_Y = 19;
const PDF_CONTENT_TOP = 28;

function resolveLayoutMode(bundle: ProformaExportBundle): ProformaLayoutMode {
  if (bundle.layoutMode === 'employees' || bundle.layoutMode === 'positions' || bundle.layoutMode === 'both' || bundle.layoutMode === 'day_night' || bundle.layoutMode === 'sla_card') {
    return bundle.layoutMode;
  }
  if (bundle.positionGrids && bundle.positionGrids.some((g) => g.positions.length > 0)) return 'both';
  return 'employees';
}

function findSlaHours(bundle: ProformaExportBundle, objectiveName: string): number | null {
  const row = bundle.summary.find((s) => s.objectiveName === objectiveName);
  return row?.slaHours != null ? row.slaHours : null;
}

function drawObjectiveSlaSubtitle(doc: jsPDF, bundle: ProformaExportBundle, objectiveName: string) {
  const sla = findSlaHours(bundle, objectiveName);
  if (sla == null) return;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(79, 70, 229);
  doc.text(`SLA: ${formatHoursColonTotal(sla)} hs/mes`, PDF_PAGE_W - PDF_MARGIN_X - 6, 25, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

function appendDayNightPages(doc: jsPDF, bundle: ProformaExportBundle, empresa: string, issued: string) {
  bundle.objectives.forEach((grid) => {
    doc.addPage();
    drawPdfHeaderBar(doc, empresa, `HORAS DIURNAS/NOCTURNAS: ${grid.objectiveName}`, bundle.periodLabel);
    drawObjectiveSlaSubtitle(doc, bundle, grid.objectiveName);

    const pageW = PDF_PAGE_W - PDF_MARGIN_X * 2;
    const nameW = 22;
    const totalW = 14;
    const dayCount = grid.dateColumns.length || 1;
    const dayW = Math.max(4, (pageW - nameW - totalW) / dayCount);
    const colStyles: Record<number, any> = {
      0: { cellWidth: nameW, halign: 'left', fontStyle: 'bold' },
    };
    grid.dateColumns.forEach((_, i) => {
      colStyles[1 + i] = { cellWidth: dayW, halign: 'center', overflow: 'hidden' };
    });
    colStyles[1 + dayCount] = { cellWidth: totalW, halign: 'center', fontStyle: 'bold' };

    autoTable(doc, {
      startY: PDF_CONTENT_TOP,
      head: [
        ['', ...grid.dateColumns.map((d) => pdfDayNumber(d)), 'Total'],
        ['', ...grid.dateColumns.map((d) => pdfDayLetter(d)), ''],
      ],
      body: [
        ['Totales', ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.total || 0)), formatHoursColonTotal(grid.grandTotal.total)],
        ['Diurnas', ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.day || 0)), formatHoursColonTotal(grid.grandTotal.day)],
        ['Nocturnas', ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.night || 0)), formatHoursColonTotal(grid.grandTotal.night)],
      ],
      styles: { fontSize: 6, cellPadding: 0.8, halign: 'center', overflow: 'hidden', minCellHeight: 5 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 6, cellPadding: 0.6 },
      columnStyles: colStyles,
      theme: 'grid',
      margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
    });

    const y2 = (doc as any).lastAutoTable?.finalY || 60;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${empresa}  ·  Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`, PDF_MARGIN_X + 6, y2 + 6);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
}

function drawPdfHeaderBar(doc: jsPDF, left: string, center: string, right: string) {
  doc.setFillColor(240, 240, 240);
  doc.rect(10, 10, 277, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(left.toUpperCase(), PDF_MARGIN_X + 6, PDF_HEADER_Y);
  doc.text(center.toUpperCase(), PDF_PAGE_W / 2, PDF_HEADER_Y, { align: 'center' });
  doc.text(right.toUpperCase(), PDF_PAGE_W - PDF_MARGIN_X - 6, PDF_HEADER_Y, { align: 'right' });
}

/**
 * Carga el SVG del logo, reemplaza fill="white" por fillColor y devuelve un data URL PNG.
 * bgColor: color de fondo del canvas (null = transparente).
 */
async function loadLogoDataUrl(
  fillColor: string,
  bgColor: string | null,
  w = 480, h = 144,
): Promise<string | null> {
  try {
    const res = await fetch('/logo-bacar-blanco.svg');
    const svgText = (await res.text()).replace(/fill="white"/g, `fill="${fillColor}"`);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((ok, err) => { img.onload = () => ok(); img.onerror = () => err(); img.src = blobUrl; });
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(blobUrl); }
  } catch { return null; }
}

/** Encabezado de la primera página con el logo BACAR (blanco sobre oscuro) a la izquierda. */
function drawPdfLogoHeader(doc: jsPDF, center: string, right: string, logoWhiteDataUrl: string | null = null) {
  const LOGO_W = 45;
  doc.setFillColor(240, 240, 240);
  doc.rect(10, 10, 277, 14, 'F');
  doc.setFillColor(30, 41, 59);
  doc.rect(10, 10, LOGO_W, 14, 'F');

  if (logoWhiteDataUrl) {
    // Logo real: ajustar al slab con margen
    const lh = 10; // alto display
    const lw = lh * (240 / 72); // mantener proporción 240:72
    doc.addImage(logoWhiteDataUrl, 'PNG', 10 + (LOGO_W - lw) / 2, 10 + (14 - lh) / 2, lw, lh);
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('BACAR', 10 + LOGO_W / 2, PDF_HEADER_Y, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(center.toUpperCase(), PDF_PAGE_W / 2 + LOGO_W / 4, PDF_HEADER_Y, { align: 'center' });
  doc.text(right.toUpperCase(), PDF_PAGE_W - PDF_MARGIN_X - 6, PDF_HEADER_Y, { align: 'right' });
}

function summaryGrandTotals(bundle: ProformaExportBundle) {
  const hasSla = bundle.summary.some((s) => s.slaHours != null);
  return {
    total: bundle.summary.reduce((a, s) => a + s.totalHours, 0),
    day: bundle.summary.reduce((a, s) => a + s.dayHours, 0),
    night: bundle.summary.reduce((a, s) => a + s.nightHours, 0),
    sla: hasSla ? bundle.summary.reduce((a, s) => a + (s.slaHours ?? 0), 0) : null,
  };
}

function summaryFootRows(bundle: ProformaExportBundle): (string | number)[][] {
  const g = summaryGrandTotals(bundle);
  const slaCell = g.sla != null ? formatHoursColonTotal(g.sla) : '—';
  return [
    ['Totales', slaCell, formatHoursColonTotal(g.total), formatHoursColonTotal(g.day), formatHoursColonTotal(g.night)],
    ['Diurnas', '', '', formatHoursColonTotal(g.day), ''],
    ['Nocturnas', '', '', '', formatHoursColonTotal(g.night)],
  ];
}

function objectiveTableHead(grid: ProformaObjectiveGrid) {
  return [
    'Legajo',
    'Apellido y nombre/s',
    ...grid.dateColumns.map((d) => shortDayHeader(d)),
    'Totales',
  ];
}

function objectiveTableHeadPdf(grid: ProformaObjectiveGrid) {
  return [
    'Legajo',
    'Apellido y nombre/s',
    ...grid.dateColumns.map((d) => pdfDayNumber(d)),
    'Tot.',
  ];
}

function objectiveSubHead(grid: ProformaObjectiveGrid): string[] {
  return [
    '',
    '',
    ...grid.dateColumns.map((d) => grid.dayLabels[d] || ''),
    '',
  ];
}

function objectiveSubHeadPdf(grid: ProformaObjectiveGrid): string[] {
  return [
    '',
    '',
    ...grid.dateColumns.map((d) => pdfDayLetter(d)),
    '',
  ];
}

function objectiveEmployeeBody(grid: ProformaObjectiveGrid): (string | number)[][] {
  return grid.employees.map((e) => [
    e.legajo,
    e.name,
    ...grid.dateColumns.map((d) => e.days[d]?.display || ''),
    formatHoursColonTotal(e.totalHours),
  ]);
}

function objectiveFootRows(grid: ProformaObjectiveGrid): (string | number)[][] {
  return [
    [
      '',
      'Totales',
      ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.total || 0)),
      formatHoursColonTotal(grid.grandTotal.total),
    ],
    [
      '',
      'Diurnas',
      ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.day || 0)),
      formatHoursColonTotal(grid.grandTotal.day),
    ],
    [
      '',
      'Nocturnas',
      ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.night || 0)),
      formatHoursColonTotal(grid.grandTotal.night),
    ],
  ];
}

function objectiveTableBody(grid: ProformaObjectiveGrid): (string | number)[][] {
  return [...objectiveEmployeeBody(grid), ...objectiveFootRows(grid)];
}


function positionTableHeadPdf(grid: ProformaPositionObjectiveGrid) {
  return [
    'Puesto / Horas',
    ...grid.dateColumns.map((d) => pdfDayNumber(d)),
    'Resumen',
  ];
}

function positionSubHeadPdf(grid: ProformaPositionObjectiveGrid): string[] {
  return [
    '',
    ...grid.dateColumns.map((d) => pdfDayLetter(d)),
    '',
  ];
}

function positionRowBody(grid: ProformaPositionObjectiveGrid): (string | number)[][] {
  return grid.positions.map((p) => [
    p.positionName,
    ...grid.dateColumns.map((d) => {
      const h = p.days[d]?.hours || 0;
      return h > 0 ? String(Math.round(h * 10) / 10) : '';
    }),
    String(Math.round(p.totalHours * 10) / 10),
  ]);
}

function positionFootRows(grid: ProformaPositionObjectiveGrid): (string | number)[][] {
  return [
    [
      'Totales',
      ...grid.dateColumns.map((d) => {
        const h = grid.dailyTotals[d]?.total || 0;
        return h > 0 ? String(Math.round(h * 10) / 10) : '';
      }),
      String(Math.round(grid.grandTotal.total * 10) / 10),
    ],
  ];
}

function positionPdfColumnStyles(grid: ProformaPositionObjectiveGrid) {
  const pageW = PDF_PAGE_W - PDF_MARGIN_X * 2;
  const nameW = Math.min(58, Math.max(36, pageW * 0.18));
  const totalW = 14;
  const dayCount = grid.dateColumns.length || 1;
  const dayW = Math.max(4, (pageW - nameW - totalW) / dayCount);
  const styles: Record<number, { cellWidth: number; halign?: string; overflow?: string }> = {
    0: { cellWidth: nameW, halign: 'left', overflow: 'ellipsize' },
  };
  grid.dateColumns.forEach((_, i) => {
    styles[1 + i] = { cellWidth: dayW, halign: 'center', overflow: 'hidden' };
  });
  styles[1 + dayCount] = { cellWidth: totalW, halign: 'center', overflow: 'hidden' };
  return styles;
}

function appendPositionGridPages(doc: jsPDF, bundle: ProformaExportBundle, empresa: string, issued: string) {
  const grids = (bundle.positionGrids || []).filter((g) => g.positions.length > 0);
  grids.forEach((grid) => {
    doc.addPage();
    drawPdfHeaderBar(
      doc,
      empresa,
      `REGISTRO MENSUAL DE HORAS: ${grid.objectiveName}`,
      bundle.periodLabel,
    );
    drawObjectiveSlaSubtitle(doc, bundle, grid.objectiveName);

    autoTable(doc, {
      startY: PDF_CONTENT_TOP,
      head: [positionTableHeadPdf(grid), positionSubHeadPdf(grid)],
      body: positionRowBody(grid),
      foot: positionFootRows(grid),
      styles: { fontSize: 6, cellPadding: 0.8, halign: 'center', overflow: 'hidden', minCellHeight: 5 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 6, cellPadding: 0.6 },
      footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 6, textColor: [30, 41, 59], cellPadding: 0.5 },
      columnStyles: positionPdfColumnStyles(grid),
      theme: 'grid',
      margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
      showFoot: 'lastPage',
    });

    const y2 = (doc as any).lastAutoTable?.finalY || 180;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
      `${empresa}  ·  Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`,
      PDF_MARGIN_X + 6,
      y2 + 6,
    );
  });
}

function fmtDMY(ymd: string): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
}

/** Dibuja el ícono B de BACAR en color oscuro sobre fondo blanco. */
// (logo dibujado via doc.addImage con SVG convertido a PNG en loadLogoDataUrl)

/** Dibuja una tarjeta SLA estilo hospitales. */
function drawSlaCard(
  doc: jsPDF,
  cx: number, cy: number,
  cw: number, ch: number,
  data: {
    name: string;
    startDate: string; endDate: string;
    days: number; dailyCovHours: number; pax: number;
    totalHours: number; ocRef: string;
  },
  logoDarkDataUrl: string | null = null,
) {
  const TH = 8;    // title height
  const DRH = 13;  // dates+logo row height
  const DHH = 6;   // "Detalle" header height
  const RH = 5.5;  // detail row height
  const TOTH = ch - TH - DRH - DHH - 3 * RH; // Total row height (remaining)

  const LOGO_W = cw * 0.37;
  const DATE_COL_W = (cw - LOGO_W) / 2;
  const LABEL_W = cw * 0.65;
  const VAL_W = cw - LABEL_W;

  doc.setDrawColor(190, 190, 190);
  doc.setLineWidth(0.3);

  // ── Título ──
  doc.setTextColor(180, 100, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const titleLines: string[] = doc.splitTextToSize(data.name, cw - 6);
  doc.text(titleLines[0] || '', cx + cw / 2, cy + TH - 2, { align: 'center' });
  doc.line(cx, cy + TH, cx + cw, cy + TH);

  // ── Logo (izquierda) ──
  if (logoDarkDataUrl) {
    // Logo real oscuro sobre fondo blanco, centrado en el área del logo
    const lw = LOGO_W - 6;
    const lh = lw * (72 / 240); // proporción 240:72
    doc.addImage(logoDarkDataUrl, 'PNG', cx + 3, cy + TH + (DRH - lh) / 2, lw, lh);
  } else {
    // Fallback texto
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('BACAR', cx + LOGO_W / 2, cy + TH + DRH / 2 + 2, { align: 'center' });
  }

  // línea vertical entre logo y fechas
  doc.line(cx + LOGO_W, cy + TH, cx + LOGO_W, cy + TH + DRH);

  // ── Fechas (derecha, encabezado) ──
  const dhY = cy + TH;
  const dateHeaderH = DRH * 0.48;
  doc.setFillColor(30, 41, 59);
  doc.rect(cx + LOGO_W, dhY, DATE_COL_W, dateHeaderH, 'F');
  doc.rect(cx + LOGO_W + DATE_COL_W, dhY, DATE_COL_W, dateHeaderH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text('Fecha Inicio', cx + LOGO_W + DATE_COL_W / 2, dhY + dateHeaderH - 1.5, { align: 'center' });
  doc.text('Fecha Fin', cx + LOGO_W + DATE_COL_W * 1.5, dhY + dateHeaderH - 1.5, { align: 'center' });

  // línea vertical entre las dos columnas de fecha
  doc.setDrawColor(100, 100, 100);
  doc.line(cx + LOGO_W + DATE_COL_W, dhY, cx + LOGO_W + DATE_COL_W, dhY + DRH);
  doc.setDrawColor(190, 190, 190);

  // valores de fecha
  const dateValY = dhY + dateHeaderH + (DRH - dateHeaderH) / 2 + 2;
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(fmtDMY(data.startDate), cx + LOGO_W + DATE_COL_W / 2, dateValY, { align: 'center' });
  doc.text(fmtDMY(data.endDate), cx + LOGO_W + DATE_COL_W * 1.5, dateValY, { align: 'center' });

  // ── Encabezado "Detalle" ──
  const detY = cy + TH + DRH;
  doc.setFillColor(210, 210, 210);
  doc.rect(cx, detY, cw, DHH, 'F');
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('Detalle', cx + cw / 2, detY + DHH - 1.5, { align: 'center' });
  doc.line(cx, detY + DHH, cx + cw, detY + DHH);

  // ── Filas de detalle ──
  const detailItems = [
    { label: 'Dias', value: data.days > 0 ? String(data.days) : '—' },
    { label: `Cobertura (${data.dailyCovHours > 0 ? data.dailyCovHours + 'hs' : '—'})`, value: data.dailyCovHours > 0 ? String(data.dailyCovHours) : '—' },
    { label: 'Vigiladores (Por turno)', value: data.pax > 0 ? String(data.pax) : '—' },
  ];
  detailItems.forEach((item, i) => {
    const ry = detY + DHH + i * RH;
    doc.setTextColor(50, 50, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(item.label, cx + 3, ry + RH - 1.5);
    doc.setFont('helvetica', 'bold');
    doc.text(item.value, cx + LABEL_W + VAL_W / 2, ry + RH - 1.5, { align: 'center' });
    doc.line(cx, ry + RH, cx + cw, ry + RH);
    doc.line(cx + LABEL_W, ry, cx + LABEL_W, ry + RH);
  });

  // ── Fila Total ──
  const totY = detY + DHH + 3 * RH;
  doc.setFillColor(220, 38, 38);
  doc.rect(cx, totY, LABEL_W, TOTH, 'F');
  doc.setFillColor(241, 245, 249);
  doc.rect(cx + LABEL_W, totY, VAL_W, TOTH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Total', cx + LABEL_W / 2, totY + TOTH - 2, { align: 'center' });
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8.5);
  doc.text(
    data.totalHours > 0 ? String(Math.round(data.totalHours)) : '—',
    cx + LABEL_W + VAL_W / 2, totY + TOTH - 2, { align: 'center' },
  );

  // ── Borde exterior ──
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.4);
  doc.rect(cx, cy, cw, ch);
  doc.setLineWidth(0.3);
}

/** Tarjeta por objetivo estilo hospitales: período, días, cobertura, vigiladores, total hs. */
function appendSlaCardPages(doc: jsPDF, bundle: ProformaExportBundle, empresa: string, issued: string, logoWhiteDataUrl: string | null = null, logoDarkDataUrl: string | null = null) {
  const COLS = 2;
  const ROWS_PER_PAGE = 3;
  const GAP_X = 9;
  const GAP_Y = 7;
  const PAGE_W = PDF_PAGE_W - PDF_MARGIN_X * 2;
  const CARDS_AREA_H = 210 - PDF_CONTENT_TOP - PDF_MARGIN_X - 10;
  const CARD_W = (PAGE_W - GAP_X * (COLS - 1)) / COLS;
  const CARD_H = (CARDS_AREA_H - GAP_Y * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE;

  const periodDays = (() => {
    try {
      const s = new Date(bundle.startDate + 'T00:00:00');
      const e = new Date(bundle.endDate + 'T00:00:00');
      return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    } catch { return 0; }
  })();

  const billingByName = new Map<string, import('./proformaTypes').ProformaBillingRow>();
  (bundle.billingSummary || []).forEach((r) => billingByName.set(r.objectiveName, r));

  let col = 0;
  let row = 0;
  let onPage = 0; // cards en la página actual

  bundle.summary.forEach((s) => {
    if (onPage === 0) {
      if (col !== 0 || row !== 0) doc.addPage();
      drawPdfLogoHeader(doc, `RESUMEN SLA — ${bundle.clientName}`, bundle.periodLabel, logoWhiteDataUrl);
    }

    const cx = PDF_MARGIN_X + col * (CARD_W + GAP_X);
    const cy = PDF_CONTENT_TOP + row * (CARD_H + GAP_Y);

    const billing = billingByName.get(s.objectiveName);
    drawSlaCard(doc, cx, cy, CARD_W, CARD_H, {
      name: s.objectiveName,
      startDate: bundle.startDate,
      endDate: bundle.endDate,
      days: periodDays,
      dailyCovHours: s.dailyCoverageHours ?? 0,
      pax: s.pax ?? 0,
      totalHours: s.slaHours ?? s.totalHours,
      ocRef: billing?.ocNumber || '—',
    }, logoDarkDataUrl);

    col++;
    onPage++;
    if (col >= COLS) { col = 0; row++; }
    if (row >= ROWS_PER_PAGE) { col = 0; row = 0; onPage = 0; }
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `${empresa}  ·  Emisión: ${issued.split(',')[0]}`,
    PDF_MARGIN_X + 6, 206,
  );
  doc.setTextColor(0, 0, 0);
}

function objectivePdfColumnStyles(grid: ProformaObjectiveGrid) {
  const pageW = PDF_PAGE_W - PDF_MARGIN_X * 2;
  const legajoW = 10;
  const nameW = Math.min(52, Math.max(34, pageW * 0.15));
  const totalW = 11;
  const dayCount = grid.dateColumns.length || 1;
  const dayW = Math.max(4, (pageW - legajoW - nameW - totalW) / dayCount);
  const styles: Record<number, { cellWidth: number; halign?: string; overflow?: string }> = {
    0: { cellWidth: legajoW },
    1: { cellWidth: nameW, halign: 'left', overflow: 'ellipsize' },
  };
  grid.dateColumns.forEach((_, i) => {
    styles[2 + i] = { cellWidth: dayW, halign: 'center', overflow: 'hidden' };
  });
  styles[2 + dayCount] = { cellWidth: totalW, halign: 'center', overflow: 'hidden' };
  return styles;
}

function objectivePdfDidParseCell(grid: ProformaObjectiveGrid) {
  const dayStart = 2;
  const dayEnd = 2 + grid.dateColumns.length;
  return (data: any) => {
    if (data.section === 'foot') {
      data.cell.styles.fontSize = 4.8;
      data.cell.styles.cellPadding = { top: 0.4, right: 0.2, bottom: 0.4, left: 0.2 };
      data.cell.styles.overflow = 'hidden';
      data.cell.styles.minCellHeight = 4;
      if (data.column.index >= dayStart && data.column.index < dayEnd) {
        data.cell.styles.halign = 'center';
      }
      return;
    }
    if (data.section === 'body' && data.column.index >= dayStart && data.column.index <= dayEnd) {
      data.cell.styles.overflow = 'hidden';
    }
  };
}

export async function exportProformaPdf(bundle: ProformaExportBundle) {
  const [logoWhiteDataUrl, logoDarkDataUrl] = await Promise.all([
    loadLogoDataUrl('white', '#1E2937'),       // logo blanco sobre fondo oscuro (encabezado)
    loadLogoDataUrl('#1E2937', null),           // logo oscuro sobre transparente (tarjeta)
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const issued = bundle.issuedAt.toLocaleString('es-AR');
  const empresa = bundle.empresaName || 'COSP';

  drawPdfLogoHeader(doc, `PRE-FACTURA — ${bundle.clientName}`, bundle.periodLabel, logoWhiteDataUrl);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`CUIT: ${bundle.taxId || '—'}  ·  ${bundle.legalName || ''}`, PDF_MARGIN_X + 6, 24);

  autoTable(doc, {
    startY: PDF_CONTENT_TOP,
    head: [['Objetivo / Sede', 'SLA', 'Hs Totales', 'Diurnas', 'Nocturnas']],
    body: bundle.summary.map((s) => [
      s.objectiveName,
      s.slaHours != null ? formatHoursColonTotal(s.slaHours) : '—',
      formatHoursColonTotal(s.totalHours),
      formatHoursColonTotal(s.dayHours),
      formatHoursColonTotal(s.nightHours),
    ]),
    foot: summaryFootRows(bundle),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 7.5, textColor: [30, 41, 59] },
    columnStyles: { 1: { textColor: [79, 70, 229] } },
    theme: 'grid',
    showFoot: 'lastPage',
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 80;
  doc.setFontSize(8);
  doc.text(`Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`, PDF_MARGIN_X + 6, finalY + 8);

  const layout = resolveLayoutMode(bundle);

  if (layout === 'employees' || layout === 'both') {
    bundle.objectives.filter((grid) => grid.employees.length > 0).forEach((grid) => {
      doc.addPage();
      drawPdfHeaderBar(doc, empresa, grid.objectiveName, bundle.periodLabel);
      drawObjectiveSlaSubtitle(doc, bundle, grid.objectiveName);

      autoTable(doc, {
        startY: PDF_CONTENT_TOP,
        head: [objectiveTableHeadPdf(grid), objectiveSubHeadPdf(grid)],
        body: objectiveEmployeeBody(grid),
        foot: objectiveFootRows(grid),
        styles: { fontSize: 6, cellPadding: 0.8, halign: 'center', overflow: 'hidden', minCellHeight: 5 },
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 6, cellPadding: 0.6 },
        footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 4.8, textColor: [30, 41, 59], cellPadding: 0.4 },
        columnStyles: objectivePdfColumnStyles(grid),
        theme: 'grid',
        margin: { left: PDF_MARGIN_X, right: PDF_MARGIN_X },
        showFoot: 'lastPage',
        didParseCell: objectivePdfDidParseCell(grid),
      });

      const y2 = (doc as any).lastAutoTable?.finalY || 180;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(`Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`, PDF_MARGIN_X + 6, y2 + 6);
    });
  }

  if (layout === 'positions' || layout === 'both') {
    appendPositionGridPages(doc, bundle, empresa, issued);
  }

  if (layout === 'day_night') {
    appendDayNightPages(doc, bundle, empresa, issued);
  }

  if (layout === 'sla_card') {
    appendSlaCardPages(doc, bundle, empresa, issued, logoWhiteDataUrl, logoDarkDataUrl);
  }

  if (bundle.eventos && bundle.eventos.length > 0) {
    const evTotalHoras = bundle.eventos.reduce((a, e) => a + e.totalHoras, 0);
    doc.addPage();
    drawPdfHeaderBar(doc, empresa, `EVENTOS — ${bundle.clientName}`, bundle.periodLabel);
    const evRows: (string | number)[][] = [];
    bundle.eventos.forEach((ev: ProformaEvento) => {
      ev.dias.forEach((dia) => {
        evRows.push([
          ev.eventoNombre,
          dia.fecha,
          dia.servicios.map((s) => s.servicioNombre).join(' · ') || '—',
          formatHoursColonTotal(dia.horasVendidas),
          formatHoursColonTotal(dia.horasTrabajadas),
        ]);
      });
      evRows.push(['', '', `Total ${ev.eventoNombre}`, formatHoursColonTotal(ev.totalHoras), formatHoursColonTotal(ev.horasTrabajadas)]);
    });
    autoTable(doc, {
      startY: PDF_CONTENT_TOP,
      head: [['Evento', 'Día', 'Servicio', 'Hs vendidas', 'Hs trabajadas']],
      body: evRows,
      foot: [['', '', 'Total eventos', formatHoursColonTotal(evTotalHoras), formatHoursColonTotal(bundle.eventos.reduce((a, e) => a + e.horasTrabajadas, 0))]],
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 7, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 22 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 28, halign: 'center' },
      },
      theme: 'grid',
      showFoot: 'lastPage',
    });
  }

  const fname = `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.pdf`;
  doc.save(fname);
}

export function exportProformaCsv(bundle: ProformaExportBundle) {
  const lines: string[] = [];
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  lines.push('RESUMEN PRE-FACTURA');
  lines.push([esc('Cliente'), esc(bundle.clientName), esc('Periodo'), esc(bundle.periodLabel)].join(','));
  lines.push([esc('CUIT'), esc(bundle.taxId), esc('Razon Social'), esc(bundle.legalName)].join(','));
  lines.push('');
  lines.push(['Objetivo', 'SLA', 'Hs Totales', 'Diurnas', 'Nocturnas'].map(esc).join(','));
  bundle.summary.forEach((s) => {
    lines.push([
      s.objectiveName,
      s.slaHours != null ? formatHoursColonTotal(s.slaHours) : '—',
      formatHoursColonTotal(s.totalHours),
      formatHoursColonTotal(s.dayHours),
      formatHoursColonTotal(s.nightHours),
    ].map(esc).join(','));
  });
  const g = summaryGrandTotals(bundle);
  lines.push(['Totales', g.sla != null ? formatHoursColonTotal(g.sla) : '—', formatHoursColonTotal(g.total), formatHoursColonTotal(g.day), formatHoursColonTotal(g.night)].map(esc).join(','));
  lines.push('');

  const layout = resolveLayoutMode(bundle);

  if (layout === 'employees' || layout === 'both') {
    bundle.objectives.forEach((grid) => {
      lines.push(`OBJETIVO (empleados): ${grid.objectiveName}`);
      lines.push(objectiveTableHead(grid).map(esc).join(','));
      lines.push(objectiveSubHead(grid).map(esc).join(','));
      objectiveTableBody(grid).forEach((row) => lines.push(row.map(esc).join(',')));
      lines.push('');
    });
  }

  if (layout === 'positions' || layout === 'both') {
    (bundle.positionGrids || []).forEach((grid) => {
      lines.push(`OBJETIVO (puestos): ${grid.objectiveName}`);
      lines.push(['Puesto / Horas', ...grid.dateColumns.map((d) => shortDayHeader(d)), 'Resumen'].map(esc).join(','));
      lines.push(['', ...grid.dateColumns.map((d) => grid.dayLabels[d] || ''), ''].map(esc).join(','));
      grid.positions.forEach((p) => {
        lines.push([
          p.positionName,
          ...grid.dateColumns.map((d) => (p.days[d]?.hours > 0 ? String(Math.round(p.days[d].hours * 10) / 10) : '')),
          String(Math.round(p.totalHours * 10) / 10),
        ].map(esc).join(','));
      });
      lines.push([
        'Totales',
        ...grid.dateColumns.map((d) => {
          const h = grid.dailyTotals[d]?.total || 0;
          return h > 0 ? String(Math.round(h * 10) / 10) : '';
        }),
        String(Math.round(grid.grandTotal.total * 10) / 10),
      ].map(esc).join(','));
      lines.push('');
    });
  }

  if (bundle.eventos && bundle.eventos.length > 0) {
    lines.push('EVENTOS');
    lines.push(['Evento', 'Día', 'Servicio', 'Hs vendidas', 'Hs trabajadas (no facturan)'].map(esc).join(','));
    bundle.eventos.forEach((ev) => {
      ev.dias.forEach((dia) => {
        const servicios = dia.servicios.map((s) => s.servicioNombre).join(' · ');
        lines.push([ev.eventoNombre, dia.fecha, servicios, formatHoursColonTotal(dia.horasVendidas), formatHoursColonTotal(dia.horasTrabajadas)].map(esc).join(','));
      });
      lines.push(['', `Total ${ev.eventoNombre}`, '', formatHoursColonTotal(ev.totalHoras), formatHoursColonTotal(ev.horasTrabajadas)].map(esc).join(','));
    });
    const evTotal = bundle.eventos.reduce((a, e) => a + e.totalHoras, 0);
    const evTrab = bundle.eventos.reduce((a, e) => a + e.horasTrabajadas, 0);
    lines.push(['', '', 'Total eventos', formatHoursColonTotal(evTotal), formatHoursColonTotal(evTrab)].map(esc).join(','));
    lines.push('');
  }

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.csv`);
}

export function exportProformaExcel(bundle: ProformaExportBundle) {
  const wb = XLSX.utils.book_new();
  const g = summaryGrandTotals(bundle);

  const summaryRows: (string | number)[][] = [
    ['PRE-FACTURA'],
    ['Cliente', bundle.clientName],
    ['Razón Social', bundle.legalName || ''],
    ['CUIT', bundle.taxId || ''],
    ['Período', bundle.periodLabel],
    ['Emitido', bundle.issuedAt.toLocaleString('es-AR')],
    [],
    ['Objetivo', 'SLA', 'Hs Totales', 'Diurnas', 'Nocturnas'],
    ...bundle.summary.map((s) => [
      s.objectiveName,
      s.slaHours != null ? formatHoursColonTotal(s.slaHours) : '—',
      formatHoursColonTotal(s.totalHours),
      formatHoursColonTotal(s.dayHours),
      formatHoursColonTotal(s.nightHours),
    ]),
    ['Totales', g.sla != null ? formatHoursColonTotal(g.sla) : '—', formatHoursColonTotal(g.total), formatHoursColonTotal(g.day), formatHoursColonTotal(g.night)],
    ['Diurnas', '', '', formatHoursColonTotal(g.day), ''],
    ['Nocturnas', '', '', '', formatHoursColonTotal(g.night)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Resumen');

  const layout = resolveLayoutMode(bundle);

  if (layout === 'employees' || layout === 'both') {
    bundle.objectives.forEach((grid, idx) => {
      const sheetName = grid.objectiveName.slice(0, 28).replace(/[\\/*?:[\]]/g, '') || `Obj_${idx + 1}`;
      const rows: (string | number)[][] = [
        [bundle.empresaName || 'COSP', grid.objectiveName, bundle.periodLabel],
        [],
        objectiveTableHead(grid),
        objectiveSubHead(grid),
        ...objectiveTableBody(grid),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
    });
  }

  if (layout === 'positions' || layout === 'both') {
    (bundle.positionGrids || []).forEach((grid, idx) => {
      const sheetName = (`P_${grid.objectiveName}`).slice(0, 28).replace(/[\\/*?:[\]]/g, '') || `Puestos_${idx + 1}`;
      const rows: (string | number)[][] = [
        [bundle.empresaName || 'COSP', `REGISTRO MENSUAL DE HORAS: ${grid.objectiveName}`, bundle.periodLabel],
        [],
        ['Puesto / Horas', ...grid.dateColumns.map((d) => shortDayHeader(d)), 'Resumen'],
        ['', ...grid.dateColumns.map((d) => grid.dayLabels[d] || ''), ''],
        ...grid.positions.map((p) => [
          p.positionName,
          ...grid.dateColumns.map((d) => (p.days[d]?.hours > 0 ? Math.round(p.days[d].hours * 10) / 10 : '')),
          Math.round(p.totalHours * 10) / 10,
        ]),
        [
          'Totales',
          ...grid.dateColumns.map((d) => {
            const h = grid.dailyTotals[d]?.total || 0;
            return h > 0 ? Math.round(h * 10) / 10 : '';
          }),
          Math.round(grid.grandTotal.total * 10) / 10,
        ],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
    });
  }

  if (bundle.eventos && bundle.eventos.length > 0) {
    const evRows: (string | number)[][] = [
      [bundle.empresaName || 'COSP', 'EVENTOS', bundle.periodLabel],
      [],
      ['Evento', 'Día', 'Servicio', 'Hs vendidas', 'Hs trabajadas (no facturan)'],
    ];
    bundle.eventos.forEach((ev) => {
      ev.dias.forEach((dia) => {
        evRows.push([
          ev.eventoNombre,
          dia.fecha,
          dia.servicios.map((s) => s.servicioNombre).join(' · '),
          formatHoursColonTotal(dia.horasVendidas),
          formatHoursColonTotal(dia.horasTrabajadas),
        ]);
      });
      evRows.push(['', `Total ${ev.eventoNombre}`, '', formatHoursColonTotal(ev.totalHoras), formatHoursColonTotal(ev.horasTrabajadas)]);
    });
    evRows.push([
      '',
      'Total eventos',
      '',
      formatHoursColonTotal(bundle.eventos.reduce((a, e) => a + e.totalHoras, 0)),
      formatHoursColonTotal(bundle.eventos.reduce((a, e) => a + e.horasTrabajadas, 0)),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evRows), 'Eventos');
  }

  XLSX.writeFile(wb, `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.xlsx`);
}

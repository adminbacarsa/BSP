/**
 * PDF formal de liquidación de horas (por legajo).
 * Resumen ejecutivo + detalle con subtotales por inicial de apellido + total general.
 * Helvetica (jsPDF) no soporta Unicode → pdfSafe.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type LiquidacionPdfRow = {
  id?: string;
  legajo?: string;
  name: string;
  shifts?: number;
  shiftsTotal?: number;
  total?: number;
  horasTeoricas?: number;
  horasCobertura?: number;
  horasDespliegue?: number;
  horasReales?: number;
  horasRealesCobertura?: number;
  horasRealesDespliegue?: number;
  diurnas?: number;
  nocturnas?: number;
  extra50?: number;
  extra100?: number;
  plusFeriado?: number;
  ftCount?: number;
  ffCount?: number;
  novedadesRRHH?: { vacacionesDias?: number; [k: string]: unknown };
};

export type LiquidacionPdfKpis = {
  legajos: number;
  planCobertura: number;
  fueraCob: number;
  realesCob: number;
  realesFuera: number;
  al50: number;
  al100?: number;
  plusFeriado?: number;
  turnos?: number;
};

export type LiquidacionPdfOpts = {
  rows: LiquidacionPdfRow[];
  empresaName: string;
  periodLabel: string;
  publishFilterLabel?: string;
  usePlannedHours?: boolean;
  kpis: LiquidacionPdfKpis;
  issuedAt?: Date;
};

function pdfSafe(text: string): string {
  return String(text || '')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00B7\u2022]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtHs(v: unknown): string {
  const x = n(v);
  if (Math.abs(x) < 0.05) return '-';
  return x.toFixed(1);
}

function fmtInt(v: unknown): string {
  const x = Math.round(n(v));
  return x === 0 ? '-' : String(x);
}

function issuedLabel(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function surnameInitial(name: string): string {
  const raw = String(name || '').trim().toUpperCase();
  if (!raw) return '#';
  const first = raw.charAt(0);
  const map: Record<string, string> = {
    Á: 'A', À: 'A', Ä: 'A', Â: 'A',
    É: 'E', È: 'E', Ë: 'E', Ê: 'E',
    Í: 'I', Ì: 'I', Ï: 'I', Î: 'I',
    Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O',
    Ú: 'U', Ù: 'U', Ü: 'U', Û: 'U',
    Ñ: 'N',
  };
  const ch = map[first] || first;
  return /[A-Z]/.test(ch) ? ch : '#';
}

function notesFor(row: LiquidacionPdfRow): string {
  const parts: string[] = [];
  if (n(row.ftCount) > 0) parts.push(`FT:${row.ftCount}`);
  if (n(row.ffCount) > 0) parts.push(`FF:${row.ffCount}`);
  const vac = n(row.novedadesRRHH?.vacacionesDias);
  if (vac > 0) parts.push(`Vac:${vac}d`);
  return parts.join(' ');
}

type LetterGroup = {
  letter: string;
  rows: LiquidacionPdfRow[];
  shifts: number;
  teoricas: number;
  reales: number;
  diurnas: number;
  nocturnas: number;
  extra50: number;
  extra100: number;
  plusFeriado: number;
};

function groupByLetter(rows: LiquidacionPdfRow[]): LetterGroup[] {
  const map = new Map<string, LiquidacionPdfRow[]>();
  for (const r of rows) {
    const L = surnameInitial(r.name);
    if (!map.has(L)) map.set(L, []);
    map.get(L)!.push(r);
  }
  const letters = [...map.keys()].sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });
  return letters.map((letter) => {
    const list = (map.get(letter) || []).slice().sort((a, b) =>
      String(a.name).localeCompare(String(b.name), 'es'),
    );
    return {
      letter,
      rows: list,
      shifts: list.reduce((a, r) => a + n(r.shiftsTotal ?? r.shifts), 0),
      teoricas: list.reduce((a, r) => a + n(r.horasTeoricas ?? r.total), 0),
      reales: list.reduce((a, r) => a + n(r.horasReales), 0),
      diurnas: list.reduce((a, r) => a + n(r.diurnas), 0),
      nocturnas: list.reduce((a, r) => a + n(r.nocturnas), 0),
      extra50: list.reduce((a, r) => a + n(r.extra50), 0),
      extra100: list.reduce((a, r) => a + n(r.extra100), 0),
      plusFeriado: list.reduce((a, r) => a + n(r.plusFeriado), 0),
    };
  });
}

function drawLetterhead(
  doc: jsPDF,
  empresa: string,
  title: string,
  periodLabel: string,
  pageW: number,
) {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(pdfSafe(String(empresa || 'COSP').toUpperCase()), 14, 11);
  doc.setFontSize(14);
  doc.text(pdfSafe(title.toUpperCase()), 14, 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const periodLines = doc.splitTextToSize(pdfSafe(periodLabel), 90);
  doc.text(periodLines, pageW - 14, 12, { align: 'right' });
  doc.setDrawColor(99, 102, 241);
  doc.setLineWidth(0.6);
  doc.line(14, 28.5, pageW - 14, 28.5);
  doc.setTextColor(0, 0, 0);
}

function drawFooter(doc: jsPDF, empresa: string, issued: string, pageW: number, pageH: number) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(14, pageH - 10, pageW - 14, pageH - 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(pdfSafe(`${empresa} - ${issued} - Confidencial - Uso interno`), 14, pageH - 5);
    doc.text(`Pag. ${i} / ${pages}`, pageW - 14, pageH - 5, { align: 'right' });
  }
}

/**
 * Genera y descarga el PDF de liquidación.
 */
export function exportLiquidacionReportPdf(opts: LiquidacionPdfOpts): void {
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  if (rows.length === 0) {
    throw new Error('No hay legajos para exportar. Genera la liquidacion primero.');
  }

  const empresa = pdfSafe(String(opts.empresaName || 'COSP').trim() || 'COSP');
  const issuedAt = opts.issuedAt || new Date();
  const issued = issuedLabel(issuedAt);
  const periodLabel = pdfSafe(String(opts.periodLabel || 'Periodo CCT').trim());
  const publishLbl = pdfSafe(String(opts.publishFilterLabel || '').trim());
  const hoursMode = opts.usePlannedHours ? 'Horas planificadas' : 'Horas reales fichadas';

  const groups = groupByLetter(rows);
  const k = opts.kpis;

  const grand = {
    legajos: rows.length,
    shifts: rows.reduce((a, r) => a + n(r.shiftsTotal ?? r.shifts), 0),
    teoricas: rows.reduce((a, r) => a + n(r.horasTeoricas ?? r.total), 0),
    reales: rows.reduce((a, r) => a + n(r.horasReales), 0),
    diurnas: rows.reduce((a, r) => a + n(r.diurnas), 0),
    nocturnas: rows.reduce((a, r) => a + n(r.nocturnas), 0),
    extra50: rows.reduce((a, r) => a + n(r.extra50), 0),
    extra100: rows.reduce((a, r) => a + n(r.extra100), 0),
    plusFeriado: rows.reduce((a, r) => a + n(r.plusFeriado), 0),
  };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Portada / resumen ──
  drawLetterhead(doc, empresa, 'Liquidacion de horas', periodLabel, pageW);

  let y = 36;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(pdfSafe(`Emision: ${issued}`), 14, y);
  y += 5;
  doc.text(pdfSafe(`Base de calculo: ${hoursMode}`), 14, y);
  y += 5;
  if (publishLbl) {
    doc.text(pdfSafe(`Cronograma: ${publishLbl}`), 14, y);
    y += 5;
  }
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    pdfSafe(
      `${grand.legajos} legajo(s) - ${grand.shifts} turnos - Totales al pie de cada seccion alfabetica`,
    ),
    14,
    y,
  );
  y += 8;
  doc.setTextColor(0, 0, 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('1. Resumen ejecutivo', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor', 'Detalle']],
    body: [
      ['Legajos', String(k.legajos), 'Con actividad en el periodo'],
      ['Plan cobertura (hs)', fmtHs(k.planCobertura), 'Teoricas sin RET/REF/ESC'],
      ['Fuera cobertura (hs)', fmtHs(k.fueraCob), 'RET + REF + ESC teoricas'],
      ['Reales cobertura (hs)', fmtHs(k.realesCob), 'Trabajadas cobertura'],
      ['Reales fuera (hs)', fmtHs(k.realesFuera), 'RET + REF + ESC reales'],
      ['Al 50% (hs)', fmtHs(k.al50), 'Excedente CCT'],
      ['Al 100% / FT (hs)', fmtHs(k.al100 ?? grand.extra100), 'Franco trabajado / 100%'],
      ['Plus feriado (hs)', fmtHs(k.plusFeriado ?? grand.plusFeriado), 'Recargo feriado'],
    ],
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 'auto' },
    },
    theme: 'grid',
    margin: { left: 14, right: 14 },
  });

  // ── Detalle por legajo ──
  doc.addPage();
  const pageW2 = pageW;
  const drawDetailHead = () => {
    drawLetterhead(doc, empresa, 'Liquidacion - Detalle por legajo', periodLabel, pageW2);
  };
  drawDetailHead();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Detalle por legajo (subtotales por inicial)', 14, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    pdfSafe('Columnas: Teor. = hs teoricas | Real = hs reales | D/N = diurnas/nocturnas | Notas = FT/FF/Vac'),
    14,
    41,
  );
  doc.setTextColor(0, 0, 0);

  const headCols = [
    'Legajo',
    'Empleado',
    'Turnos',
    'Teor.',
    'Real',
    'Diurnas',
    'Noct.',
    '50%',
    '100%',
    'Plus F.',
    'Notas',
  ];

  type Cell =
    | string
    | {
        content: string;
        colSpan?: number;
        styles?: Record<string, unknown>;
      };
  const body: Cell[][] = [];
  for (const g of groups) {
    body.push([
      {
        content: pdfSafe(`  ${g.letter}  (${g.rows.length} legajos)`),
        colSpan: 11,
        styles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 8,
        },
      },
    ]);
    for (const r of g.rows) {
      body.push([
        pdfSafe(String(r.legajo || '-')),
        pdfSafe(String(r.name || '-')),
        fmtInt(r.shiftsTotal ?? r.shifts),
        fmtHs(r.horasTeoricas ?? r.total),
        fmtHs(r.horasReales),
        fmtHs(r.diurnas),
        fmtHs(r.nocturnas),
        fmtHs(r.extra50),
        fmtHs(r.extra100),
        fmtHs(r.plusFeriado),
        pdfSafe(notesFor(r) || '-'),
      ]);
    }
    body.push([
      {
        content: pdfSafe(`Subtotal ${g.letter}`),
        colSpan: 2,
        styles: { fontStyle: 'bold', fillColor: [248, 250, 252] },
      },
      fmtInt(g.shifts),
      fmtHs(g.teoricas),
      fmtHs(g.reales),
      fmtHs(g.diurnas),
      fmtHs(g.nocturnas),
      fmtHs(g.extra50),
      fmtHs(g.extra100),
      fmtHs(g.plusFeriado),
      '',
    ]);
  }

  let detailPage = 0;
  autoTable(doc, {
    startY: 44,
    head: [headCols],
    body: body as any,
    foot: [[
      { content: 'TOTAL GENERAL', colSpan: 2, styles: { fontStyle: 'bold' } },
      fmtInt(grand.shifts),
      fmtHs(grand.teoricas),
      fmtHs(grand.reales),
      fmtHs(grand.diurnas),
      fmtHs(grand.nocturnas),
      fmtHs(grand.extra50),
      fmtHs(grand.extra100),
      fmtHs(grand.plusFeriado),
      `${grand.legajos} leg.`,
    ]] as any,
    styles: { fontSize: 6.5, cellPadding: 1.1, font: 'helvetica', overflow: 'linebreak' },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 16, fontSize: 6 },
      1: { cellWidth: 52 },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 16, halign: 'right' },
      6: { cellWidth: 14, halign: 'right' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 14, halign: 'right' },
      9: { cellWidth: 14, halign: 'right' },
      10: { cellWidth: 18, fontSize: 6 },
    },
    theme: 'grid',
    margin: { left: 10, right: 10, top: 32, bottom: 14 },
    showFoot: 'lastPage',
    didDrawPage: () => {
      detailPage += 1;
      if (detailPage > 1) drawDetailHead();
    },
  });

  drawFooter(doc, empresa, issued, pageW, pageH);

  const fname = `Liquidacion_${sanitizeFilename(periodLabel)}_${issuedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}

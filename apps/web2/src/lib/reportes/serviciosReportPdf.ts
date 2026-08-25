/**
 * PDF membretado del reporte Servicios (contratos SLA).
 * Agrupa por cliente, detalla objetivos con subtotales y respeta filtros activos.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { isSlaContractActive } from '@/lib/slaPlanningMatch';
import { toYyyyMmDd } from '@/lib/firestoreDates';

export type ServiciosReportPdfRow = {
  id?: string;
  clientName?: string;
  objectiveName?: string;
  startDate?: unknown;
  endDate?: unknown;
  status?: unknown;
  positions?: unknown[];
  coverageType?: string;
  totalMonthlyHours?: number;
  serviceRotations?: unknown[];
  serviceRules?: unknown[];
};

export type ServiciosReportPdfOpts = {
  rows: ServiciosReportPdfRow[];
  empresaName: string;
  periodLabel: string;
  filterLabel?: string;
  issuedAt?: Date;
};

type ClientGroup = {
  clientName: string;
  rows: ServiciosReportPdfRow[];
  hours: number;
  activos: number;
  inactivos: number;
  puestos: number;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
}

function fmtYmd(value: unknown): string {
  const ymd = toYyyyMmDd(value);
  if (!ymd || ymd.length < 10) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function coverageLabel(s: ServiciosReportPdfRow): string {
  const types = [
    ...new Set(
      (s.positions || []).map((p: any) => String(p?.coverageType || '24hs')),
    ),
  ];
  if (types.length === 0) return '—';
  if (types.length === 1) return String(types[0]);
  return 'Mixto';
}

function rowHours(s: ServiciosReportPdfRow): number {
  const n = Number(s.totalMonthlyHours);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rowPuestos(s: ServiciosReportPdfRow): number {
  return Array.isArray(s.positions) ? s.positions.length : 0;
}

function groupByClient(rows: ServiciosReportPdfRow[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  for (const s of rows) {
    const clientName = String(s.clientName || 'Sin cliente').trim() || 'Sin cliente';
    let g = map.get(clientName);
    if (!g) {
      g = { clientName, rows: [], hours: 0, activos: 0, inactivos: 0, puestos: 0 };
      map.set(clientName, g);
    }
    g.rows.push(s);
    g.hours += rowHours(s);
    g.puestos += rowPuestos(s);
    if (isSlaContractActive(s.status)) g.activos += 1;
    else g.inactivos += 1;
  }
  for (const g of map.values()) {
    g.rows.sort((a, b) =>
      String(a.objectiveName || '').localeCompare(String(b.objectiveName || ''), 'es'),
    );
  }
  return [...map.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'));
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
  doc.setFontSize(14);
  doc.text(String(empresa || 'COSP').toUpperCase(), 14, 12);
  doc.setFontSize(11);
  doc.text(title.toUpperCase(), 14, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(periodLabel, pageW - 14, 12, { align: 'right' });
  doc.setFontSize(8);
  doc.text('Reporte de contratos SLA', pageW - 14, 20, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

function drawFooter(doc: jsPDF, empresa: string, issued: string, pageW: number, pageH: number) {
  const total = (doc as any).internal.getNumberOfPages() as number;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, pageH - 12, pageW - 14, pageH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`${empresa} · ${issued} · Confidencial`, 14, pageH - 6);
    doc.text(`Página ${i} / ${total}`, pageW - 14, pageH - 6, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
}

/** Genera y descarga PDF membretado del reporte Servicios filtrado. */
export function exportServiciosReportPdf(opts: ServiciosReportPdfOpts): void {
  const rows = opts.rows || [];
  if (rows.length === 0) {
    throw new Error('No hay servicios para exportar con los filtros actuales');
  }

  const empresa = String(opts.empresaName || 'COSP').trim() || 'COSP';
  const issuedAt = opts.issuedAt || new Date();
  const issued = issuedAt.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const periodLabel = opts.periodLabel || 'Período';
  const filterLabel = String(opts.filterLabel || '').trim();

  const groups = groupByClient(rows);
  const grandHours = groups.reduce((a, g) => a + g.hours, 0);
  const grandPuestos = groups.reduce((a, g) => a + g.puestos, 0);
  const grandActivos = groups.reduce((a, g) => a + g.activos, 0);
  const grandInactivos = groups.reduce((a, g) => a + g.inactivos, 0);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  drawLetterhead(doc, empresa, 'Reporte de servicios', periodLabel, pageW);

  let y = 36;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Emisión: ${issued}`, 14, y);
  y += 5;
  doc.text(
    `Totales: ${rows.length} servicio(s) · ${groups.length} cliente(s) · ${grandActivos} activos · ${grandInactivos} inactivos · ${grandPuestos} puestos · ${Math.round(grandHours).toLocaleString('es-AR')} hs/mes`,
    14,
    y,
  );
  y += 5;
  if (filterLabel) {
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Filtros: ${filterLabel}`, 14, y);
    y += 6;
  } else {
    y += 2;
  }
  doc.setTextColor(0, 0, 0);

  // Resumen por cliente
  autoTable(doc, {
    startY: y,
    head: [['Cliente', 'Objetivos', 'Activos', 'Inactivos', 'Puestos', 'Hs/mes']],
    body: groups.map((g) => [
      g.clientName,
      String(g.rows.length),
      String(g.activos),
      String(g.inactivos),
      String(g.puestos),
      Math.round(g.hours).toLocaleString('es-AR'),
    ]),
    foot: [[
      'TOTAL GENERAL',
      String(rows.length),
      String(grandActivos),
      String(grandInactivos),
      String(grandPuestos),
      Math.round(grandHours).toLocaleString('es-AR'),
    ]],
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', textColor: [15, 23, 42] },
    columnStyles: {
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'right' },
    },
    theme: 'grid',
    margin: { left: 14, right: 14 },
    showFoot: 'lastPage',
  });

  // Detalle por cliente
  for (const g of groups) {
    doc.addPage();
    drawLetterhead(doc, empresa, g.clientName, periodLabel, pageW);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Detalle de objetivos', 14, 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${g.rows.length} objetivo(s) · ${g.activos} activos · ${Math.round(g.hours).toLocaleString('es-AR')} hs/mes`,
      14,
      41,
    );
    doc.setTextColor(0, 0, 0);

    autoTable(doc, {
      startY: 45,
      head: [['Estado', 'Objetivo', 'Desde', 'Hasta', 'Puestos', 'Cobertura', 'Hs/mes', 'Rot.', 'Cond.']],
      body: g.rows.map((s) => {
        const active = isSlaContractActive(s.status);
        return [
          active ? 'Activo' : 'Inactivo',
          String(s.objectiveName || '—'),
          fmtYmd(s.startDate),
          fmtYmd(s.endDate),
          String(rowPuestos(s)),
          coverageLabel(s),
          rowHours(s) > 0 ? Math.round(rowHours(s)).toLocaleString('es-AR') : '—',
          String(s.serviceRotations?.length || 0),
          String(s.serviceRules?.length || 0),
        ];
      }),
      foot: [[
        '',
        `Subtotal ${g.clientName}`,
        '',
        '',
        String(g.puestos),
        '',
        Math.round(g.hours).toLocaleString('es-AR'),
        '',
        '',
      ]],
      styles: { fontSize: 7.5, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [238, 242, 255], fontStyle: 'bold', textColor: [49, 46, 129], fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 16 },
        1: { cellWidth: 42 },
        2: { cellWidth: 18 },
        3: { cellWidth: 18 },
        4: { halign: 'center', cellWidth: 14 },
        5: { cellWidth: 18 },
        6: { halign: 'right', cellWidth: 16 },
        7: { halign: 'center', cellWidth: 12 },
        8: { halign: 'center', cellWidth: 12 },
      },
      theme: 'grid',
      margin: { left: 14, right: 14 },
      showFoot: 'lastPage',
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const v = String(data.cell.raw || '');
        if (v === 'Activo') data.cell.styles.textColor = [5, 150, 105];
        if (v === 'Inactivo') data.cell.styles.textColor = [100, 116, 139];
      },
    });
  }

  drawFooter(doc, empresa, issued, pageW, pageH);

  const fname = `Reporte_Servicios_${sanitizeFilename(periodLabel)}_${issuedAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}

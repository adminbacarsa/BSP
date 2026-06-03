import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { ProformaExportBundle, ProformaObjectiveGrid } from './proformaTypes';
import { formatHoursColonTotal, shortDayHeader } from './proformaGrid';

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

function objectiveTableHead(grid: ProformaObjectiveGrid) {
  return [
    'Legajo',
    'Apellido y nombre/s',
    ...grid.dateColumns.map((d) => shortDayHeader(d)),
    'Totales',
  ];
}

function objectiveTableBody(grid: ProformaObjectiveGrid): (string | number)[][] {
  const rows: (string | number)[][] = grid.employees.map((e) => [
    e.legajo,
    e.name,
    ...grid.dateColumns.map((d) => e.days[d]?.display || ''),
    formatHoursColonTotal(e.totalHours),
  ]);

  rows.push([
    '',
    'Totales',
    ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.total || 0)),
    formatHoursColonTotal(grid.grandTotal.total),
  ]);
  rows.push([
    '',
    'Diurnas',
    ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.day || 0)),
    formatHoursColonTotal(grid.grandTotal.day),
  ]);
  rows.push([
    '',
    'Nocturnas',
    ...grid.dateColumns.map((d) => formatHoursColonTotal(grid.dailyTotals[d]?.night || 0)),
    formatHoursColonTotal(grid.grandTotal.night),
  ]);
  return rows;
}

function objectiveSubHead(grid: ProformaObjectiveGrid): string[] {
  return [
    '',
    '',
    ...grid.dateColumns.map((d) => grid.dayLabels[d] || ''),
    '',
  ];
}

export function exportProformaPdf(bundle: ProformaExportBundle) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const issued = bundle.issuedAt.toLocaleString('es-AR');
  const empresa = bundle.empresaName || 'COSP';

  // Resumen
  doc.setFillColor(240, 240, 240);
  doc.rect(10, 10, 277, 14, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(empresa.toUpperCase(), 14, 19);
  doc.setFontSize(11);
  doc.text(`PRE-FACTURA — ${bundle.clientName}`, 14, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Período: ${bundle.periodLabel}  ·  CUIT: ${bundle.taxId || '—'}  ·  ${bundle.legalName || ''}`, 14, 35);

  autoTable(doc, {
    startY: 40,
    head: [['Objetivo / Sede', 'Hs Totales', 'Diurnas', 'Nocturnas']],
    body: bundle.summary.map((s) => [
      s.objectiveName,
      formatHoursColonTotal(s.totalHours),
      formatHoursColonTotal(s.dayHours),
      formatHoursColonTotal(s.nightHours),
    ]),
    foot: [[
      'TOTAL CLIENTE',
      formatHoursColonTotal(bundle.summary.reduce((a, s) => a + s.totalHours, 0)),
      formatHoursColonTotal(bundle.summary.reduce((a, s) => a + s.dayHours, 0)),
      formatHoursColonTotal(bundle.summary.reduce((a, s) => a + s.nightHours, 0)),
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold' },
    theme: 'grid',
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 80;
  doc.setFontSize(8);
  doc.text(`Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`, 14, finalY + 8);

  // Una página por objetivo (solo si tiene turnos en el período)
  bundle.objectives.filter((grid) => grid.employees.length > 0).forEach((grid) => {
    doc.addPage();
    doc.setFillColor(240, 240, 240);
    doc.rect(10, 10, 277, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(empresa.toUpperCase(), 14, 19);
    doc.setFontSize(11);
    doc.text(`${grid.objectiveName.toUpperCase()}  ${bundle.periodLabel}`, 105, 19, { align: 'center' });

    autoTable(doc, {
      startY: 28,
      head: [objectiveTableHead(grid), objectiveSubHead(grid)],
      body: objectiveTableBody(grid),
      styles: { fontSize: 6, cellPadding: 1, halign: 'center', overflow: 'linebreak' },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 6 },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 38, halign: 'left' },
      },
      theme: 'grid',
      margin: { left: 8, right: 8 },
    });

    const y2 = (doc as any).lastAutoTable?.finalY || 180;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Fecha de emisión: ${issued.split(',')[0]}  ·  Hora: ${issued.split(',')[1]?.trim() || ''}`, 14, y2 + 6);
  });

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
  lines.push(['Objetivo', 'Hs Totales', 'Diurnas', 'Nocturnas'].map(esc).join(','));
  bundle.summary.forEach((s) => {
    lines.push([s.objectiveName, formatHoursColonTotal(s.totalHours), formatHoursColonTotal(s.dayHours), formatHoursColonTotal(s.nightHours)].map(esc).join(','));
  });
  lines.push('');

  bundle.objectives.forEach((grid) => {
    lines.push(`OBJETIVO: ${grid.objectiveName}`);
    lines.push(objectiveTableHead(grid).map(esc).join(','));
    lines.push(objectiveSubHead(grid).map(esc).join(','));
    objectiveTableBody(grid).forEach((row) => lines.push(row.map(esc).join(',')));
    lines.push('');
  });

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.csv`);
}

export function exportProformaExcel(bundle: ProformaExportBundle) {
  const wb = XLSX.utils.book_new();

  const summaryRows: (string | number)[][] = [
    ['PRE-FACTURA'],
    ['Cliente', bundle.clientName],
    ['Razón Social', bundle.legalName || ''],
    ['CUIT', bundle.taxId || ''],
    ['Período', bundle.periodLabel],
    ['Emitido', bundle.issuedAt.toLocaleString('es-AR')],
    [],
    ['Objetivo', 'Hs Totales', 'Diurnas', 'Nocturnas'],
    ...bundle.summary.map((s) => [
      s.objectiveName,
      formatHoursColonTotal(s.totalHours),
      formatHoursColonTotal(s.dayHours),
      formatHoursColonTotal(s.nightHours),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Resumen');

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

  XLSX.writeFile(wb, `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.xlsx`);
}

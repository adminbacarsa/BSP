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
  if (bundle.layoutMode === 'employees' || bundle.layoutMode === 'positions' || bundle.layoutMode === 'both') {
    return bundle.layoutMode;
  }
  if (bundle.positionGrids && bundle.positionGrids.some((g) => g.positions.length > 0)) return 'both';
  return 'employees';
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

export function exportProformaPdf(bundle: ProformaExportBundle) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const issued = bundle.issuedAt.toLocaleString('es-AR');
  const empresa = bundle.empresaName || 'COSP';

  drawPdfHeaderBar(doc, empresa, `PRE-FACTURA — ${bundle.clientName}`, bundle.periodLabel);
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

  if (bundle.eventos && bundle.eventos.length > 0) {
    const evTotalHoras = bundle.eventos.reduce((a, e) => a + e.totalHoras, 0);
    doc.addPage();
    drawPdfHeaderBar(doc, empresa, `EVENTOS — ${bundle.clientName}`, bundle.periodLabel);
    const evRows: (string | number)[][] = [];
    bundle.eventos.forEach((ev: ProformaEvento) => {
      ev.servicios.forEach((srv) => {
        const horario = srv.horaInicio && srv.horaFin ? `${srv.horaInicio}–${srv.horaFin}` : '—';
        const pax = srv.cupo != null ? `${srv.guardias.length}/${srv.cupo}` : `${srv.guardias.length}`;
        srv.guardias.forEach((g, i) => {
          evRows.push([
            i === 0 ? ev.eventoNombre : '',
            i === 0 ? srv.servicioNombre : '',
            i === 0 ? srv.fecha : '',
            i === 0 ? horario : '',
            i === 0 ? pax : '',
            g.name,
            formatHoursColonTotal(g.hours),
          ]);
        });
        evRows.push(['', '', '', '', '', `Subtotal ${srv.servicioNombre}`, formatHoursColonTotal(srv.totalHoras)]);
      });
      evRows.push(['', '', '', '', '', `Total ${ev.eventoNombre}`, formatHoursColonTotal(ev.totalHoras)]);
    });
    autoTable(doc, {
      startY: PDF_CONTENT_TOP,
      head: [['Evento', 'Servicio', 'Fecha', 'Horario', 'PAX', 'Guardia', 'Horas']],
      body: evRows,
      foot: [['', '', '', '', '', 'Total eventos', formatHoursColonTotal(evTotalHoras)]],
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [241, 245, 249], fontStyle: 'bold', fontSize: 7, textColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 40 },
        2: { cellWidth: 18 },
        3: { cellWidth: 18 },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 'auto' },
        6: { cellWidth: 14, halign: 'center' },
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
    lines.push(['Evento', 'Servicio', 'Fecha', 'Horario', 'PAX (cub/req)', 'Guardia', 'Horas'].map(esc).join(','));
    bundle.eventos.forEach((ev) => {
      ev.servicios.forEach((srv) => {
        const horario = srv.horaInicio && srv.horaFin ? `${srv.horaInicio}–${srv.horaFin}` : '';
        const pax = srv.cupo != null ? `${srv.guardias.length}/${srv.cupo}` : `${srv.guardias.length}`;
        srv.guardias.forEach((g) => {
          lines.push([ev.eventoNombre, srv.servicioNombre, srv.fecha, horario, pax, g.name, formatHoursColonTotal(g.hours)].map(esc).join(','));
        });
        lines.push(['', `Subtotal ${srv.servicioNombre}`, '', '', '', '', formatHoursColonTotal(srv.totalHoras)].map(esc).join(','));
      });
      lines.push(['', `Total ${ev.eventoNombre}`, '', '', '', '', formatHoursColonTotal(ev.totalHoras)].map(esc).join(','));
    });
    const evTotal = bundle.eventos.reduce((a, e) => a + e.totalHoras, 0);
    lines.push(['', '', 'Total eventos', '', formatHoursColonTotal(evTotal)].map(esc).join(','));
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
      ['Evento', 'Servicio', 'Fecha', 'Horario', 'PAX (cub/req)', 'Guardia', 'Horas'],
    ];
    bundle.eventos.forEach((ev) => {
      ev.servicios.forEach((srv) => {
        const horario = srv.horaInicio && srv.horaFin ? `${srv.horaInicio}–${srv.horaFin}` : '';
        const pax = srv.cupo != null ? `${srv.guardias.length}/${srv.cupo}` : `${srv.guardias.length}`;
        srv.guardias.forEach((g) => {
          evRows.push([ev.eventoNombre, srv.servicioNombre, srv.fecha, horario, pax, g.name, formatHoursColonTotal(g.hours)]);
        });
        evRows.push(['', `Subtotal ${srv.servicioNombre}`, '', '', '', '', formatHoursColonTotal(srv.totalHoras)]);
      });
      evRows.push(['', `Total ${ev.eventoNombre}`, '', '', '', '', formatHoursColonTotal(ev.totalHoras)]);
    });
    evRows.push(['', 'Total eventos', '', '', '', '', formatHoursColonTotal(bundle.eventos.reduce((a, e) => a + e.totalHoras, 0))]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evRows), 'Eventos');
  }

  XLSX.writeFile(wb, `Prefactura_${sanitizeFilename(bundle.clientName)}_${bundle.periodLabel.replace(/\//g, '-')}.xlsx`);
}

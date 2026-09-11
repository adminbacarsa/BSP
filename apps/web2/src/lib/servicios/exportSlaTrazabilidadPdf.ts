import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ServiceSLA } from '@/services/slaService';
import type { SlaModificacionRow } from '@/lib/servicios/slaModificaciones';
import { formatModificacionFechaAr } from '@/lib/servicios/slaModificaciones';

function pdfSafe(text: string): string {
  return String(text || '')
    .replace(/\u2192/g, '->')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00B7\u2022]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 48);
}

export type ExportSlaTrazabilidadPdfOpts = {
  service: Pick<ServiceSLA, 'clientName' | 'objectiveName' | 'startDate' | 'endDate'>;
  rows: SlaModificacionRow[];
  monthLabel: string;
  empresaName?: string;
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  issuedAt?: Date;
};

export function exportSlaTrazabilidadPdf(opts: ExportSlaTrazabilidadPdfOpts): void {
  const issued = (opts.issuedAt || new Date()).toLocaleString('es-AR');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 16, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafe(String(opts.empresaName || 'COSP').toUpperCase()), 14, 7);
  doc.setFontSize(9);
  doc.text('TRAZABILIDAD DE SERVICIO', 14, 12);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafe(`${opts.service.clientName || ''} — ${opts.service.objectiveName || 'Objetivo'}`), 14, 24);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(pdfSafe(`Periodo: ${opts.monthLabel}`), 14, 29);
  doc.text(pdfSafe(`Contrato: ${opts.service.startDate || '—'} a ${opts.service.endDate || '—'}`), 14, 33);
  doc.text(pdfSafe(`Emision: ${issued}`), 14, 37);

  let y = 42;
  if (opts.cancelReason) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text(pdfSafe(`Baja del servicio: ${opts.cancelReason}`), 14, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    if (opts.cancelledBy || opts.cancelledAt) {
      doc.text(pdfSafe([opts.cancelledBy, opts.cancelledAt?.slice(0, 10)].filter(Boolean).join(' · ')), 14, y);
      y += 4;
    }
    doc.setTextColor(30, 41, 59);
  }

  const body = opts.rows.map((row) => [
    formatModificacionFechaAr(row.at),
    row.kind,
    pdfSafe(row.title),
    pdfSafe(row.detail),
    row.hours != null && row.hours > 0 ? `${row.hours}h` : '—',
    pdfSafe(row.solicitante || '—'),
    pdfSafe(row.canal || '—'),
    pdfSafe(row.actor || '—'),
  ]);

  autoTable(doc, {
    startY: y + 2,
    head: [['Fecha', 'Tipo', 'Accion', 'Detalle', 'Hs', 'Solicito', 'Por', 'Autorizo']],
    body,
    styles: { fontSize: 6.5, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 18 },
      2: { cellWidth: 32 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 28 },
      6: { cellWidth: 28 },
      7: { cellWidth: 26 },
    },
    margin: { left: 14, right: 14 },
  });

  const obj = sanitizeFilename(opts.service.objectiveName || 'objetivo');
  const mes = sanitizeFilename(opts.monthLabel);
  doc.save(`Trazabilidad_${obj}_${mes}.pdf`);
}

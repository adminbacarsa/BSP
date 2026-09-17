import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { OpsMode } from '@/lib/operaciones/opsMode';
import type {
  CcAuditSummary,
  CcInformeRow,
  CcSessionRow,
} from '@/hooks/useSupervisionCcBoard';
import type { ObjectiveLiveSummary } from '@/hooks/useSupervisionTablero';
import {
  COVERAGE_STATUS_STYLES,
  formatYmdDisplayAr,
  rollupObjectiveCoverage,
} from '@/lib/supervision/supervisionUtils';

const TZ = 'America/Argentina/Cordoba';

function sanitize(s: string): string {
  return (s || '')
    .replace(/[^\x20-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtDt(d: Date): string {
  return d.toLocaleString('es-AR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function modeLabel(mode: OpsMode): string {
  if (mode === 'DEMO') return 'Demo (laboratorio)';
  if (mode === 'MANUAL') return 'Manual (operador en CC)';
  return 'Auto';
}

export type CcDayReportPdfInput = {
  empresaName: string;
  dateYmd: string;
  opsMode: OpsMode;
  isToday: boolean;
  livePilotName: string | null;
  sessions: CcSessionRow[];
  mandos: CcSessionRow[];
  informes: CcInformeRow[];
  auditSummary: CcAuditSummary | null;
  objectiveSummaries: ObjectiveLiveSummary[];
  totals: { activos: number; vacantes: number; ausentes: number; alertas: number } | null;
};

export function downloadSupervisionCcDayPdf(input: CcDayReportPdfInput): void {
  const pdf = new jsPDF();
  const pageW = pdf.internal.pageSize.getWidth();
  const empresa = sanitize(input.empresaName);
  const fecha = formatYmdDisplayAr(input.dateYmd);

  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageW, 52, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text('INFORME OPERATIVO DEL DÍA', pageW / 2, 22, { align: 'center' });
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Supervisión · Centro de Control', pageW / 2, 32, { align: 'center' });
  pdf.text(empresa, pageW / 2, 40, { align: 'center' });
  pdf.setFontSize(10);
  pdf.text(fecha.toUpperCase(), pageW / 2, 48, { align: 'center' });

  pdf.setTextColor(0, 0, 0);
  let y = 62;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Modo CC (referencia):', 14, y);
  pdf.setFont('helvetica', 'normal');
  pdf.text(
    input.isToday ? `${modeLabel(input.opsMode)}${input.livePilotName ? ` · A mando: ${sanitize(input.livePilotName)}` : ''}` : 'Histórico (según sesiones del día)',
    14,
    y + 6,
  );
  y += 16;

  if (input.totals && input.isToday) {
    pdf.setFont('helvetica', 'bold');
    pdf.text('Snapshot en vivo (objetivos):', 14, y);
    y += 6;
    const objRollup = rollupObjectiveCoverage(
      input.objectiveSummaries.map((o) => ({
        vacantes: o.vacantes,
        ausentes: o.ausentes,
        alertas: o.alertas,
      })),
    );
    autoTable(pdf, {
      startY: y,
      head: [['Activos', 'Vacantes', 'Ausentes', 'Obj. sin huecos']],
      body: [
        [
          String(input.totals.activos),
          String(input.totals.vacantes),
          String(input.totals.ausentes),
          `${objRollup.withoutVacancies} / ${objRollup.total}`,
        ],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 64, 175] },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (input.auditSummary) {
    pdf.setFont('helvetica', 'bold');
    pdf.text('Actividad CC (audit operaciones):', 14, y);
    y += 6;
    autoTable(pdf, {
      startY: y,
      head: [['Eventos', 'Ingresos', 'Ausencias', 'Coberturas']],
      body: [
        [
          String(input.auditSummary.total),
          String(input.auditSummary.ingresos),
          String(input.auditSummary.ausencias),
          String(input.auditSummary.coberturas),
        ],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [5, 150, 105] },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  pdf.addPage();
  y = 20;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Sesiones y mandos del día', 14, y);
  y += 8;

  const sessionBody =
    input.sessions.length > 0
      ? input.sessions.map((s) => [
          sanitize(s.operatorName),
          s.role === 'PILOTO' ? 'A mando' : 'Apoyo',
          s.status,
          fmtDt(s.startTime),
          s.endTime ? fmtDt(s.endTime) : s.status === 'ACTIVO' ? 'En curso' : '—',
        ])
      : [['—', '—', '—', 'Sin sesiones registradas', '—']];

  autoTable(pdf, {
    startY: y,
    head: [['Operador', 'Rol', 'Estado', 'Inicio', 'Fin']],
    body: sessionBody,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [79, 70, 229] },
  });
  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Informes de mando guardados', 14, y);
  y += 8;

  const infBody =
    input.informes.length > 0
      ? input.informes.map((inf) => [
          sanitize(inf.operatorName),
          fmtDt(inf.guardiaStart),
          fmtDt(inf.guardiaEnd),
          String(inf.resumen?.coberturas ?? 0),
          String(inf.resumen?.ausencias ?? 0),
          sanitize((inf.observaciones || '').slice(0, 80)),
        ])
      : [['—', '—', '—', '—', '—', 'Sin informes formales en esta fecha']];

  autoTable(pdf, {
    startY: y,
    head: [['Operador', 'Desde', 'Hasta', 'Cob.', 'Aus.', 'Observaciones']],
    body: infBody,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [124, 58, 237] },
  });
  y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  if (input.objectiveSummaries.length > 0) {
    pdf.addPage();
    y = 20;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('Objetivos (estado al generar informe)', 14, y);
    y += 8;
    autoTable(pdf, {
      startY: y,
      head: [['Objetivo', 'Cliente', 'Activos', 'Vac.', 'Aus.', 'Estado']],
      body: input.objectiveSummaries.map((o) => [
        sanitize(o.objectiveName),
        sanitize(o.clientName),
        String(o.activos),
        String(o.vacantes),
        String(o.ausentes),
        COVERAGE_STATUS_STYLES[o.status].label,
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [30, 64, 175] },
    });
  }

  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    `Generado ${fmtDt(new Date())} · COSP Supervisión CC`,
    14,
    pdf.internal.pageSize.getHeight() - 10,
  );

  const safeDate = input.dateYmd.replace(/-/g, '');
  pdf.save(`supervision_cc_${safeDate}.pdf`);
}

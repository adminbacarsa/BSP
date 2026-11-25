/**
 * PDF diario estilo Modo Rápido: espejo de la grilla para una fecha pedida.
 * Agrupa por Cliente → Objetivo. Incluye coberturas y comentarios.
 * Solo descarga; no archiva en Firebase.
 */
import {
  Timestamp,
  getDocs,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { arHmOnYmdMs, arYmd } from '@/lib/arClock';
import { isRestFrancoShift } from '@/hooks/useOperacionesMonitor';
import { empresaCollectionQuery } from '@/lib/multiempresa';

const SKIP_CODES = new Set([
  'V', 'L', 'E', 'A', 'PG', 'ART', 'AA', 'ESC', 'F', 'FF', 'FP',
]);

const PUNTUAL_HASTA_MIN = 5;

type FuenteMarca = 'WA' | 'Radio' | 'App' | 'Op' | 'Demo' | 'Auto' | '—';

type ObjInfo = { name: string; clientName: string };

type RowPdf = {
  cliente: string;
  objetivo: string;
  guardia: string;
  puesto: string;
  codigo: string;
  ingP: string;
  ingR: string;
  egrP: string;
  egrR: string;
  dif: string;
  fuente: FuenteMarca;
  estado: string;
  cobertura: string;
  comentario: string;
  startMs: number;
};

function formatHHMM(ts: Timestamp | { toDate: () => Date } | null | undefined): string {
  if (!ts || typeof (ts as Timestamp).toDate !== 'function') return '—';
  try {
    return (ts as Timestamp).toDate().toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch {
    return '—';
  }
}

function toStartMs(raw: unknown): number {
  if (raw && typeof (raw as Timestamp).toDate === 'function') {
    return (raw as Timestamp).toDate().getTime();
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const t = new Date(raw).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

function parseHHMMToMins(hhmm: string): number | null {
  const parts = String(hhmm || '').split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return parts[0] * 60 + parts[1];
}

function bloquesDelTurno(raw: unknown): Array<{ startTime: string; endTime: string }> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const out = raw
    .map((b) => ({
      startTime: String((b as { startTime?: unknown })?.startTime || '').slice(0, 5),
      endTime: String((b as { endTime?: unknown })?.endTime || '').slice(0, 5),
    }))
    .filter((b) => /^\d{2}:\d{2}$/.test(b.startTime) && /^\d{2}:\d{2}$/.test(b.endTime));
  return out.length >= 2 ? out : null;
}

function tramosDeTurno(
  startMs: number,
  blocks: Array<{ startTime: string; endTime: string }>,
): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  let prevEnd = startMs;
  blocks.forEach((b, i) => {
    const [sh, sm] = b.startTime.split(':').map(Number);
    const [eh, em] = b.endTime.split(':').map(Number);
    let s = startMs;
    if (i === 0) {
      const base = new Date(startMs);
      base.setHours(sh, sm, 0, 0);
      s = base.getTime();
      if (s > startMs + 12 * 3600000) s -= 24 * 3600000;
      if (s < startMs - 12 * 3600000) s += 24 * 3600000;
    } else {
      const base = new Date(prevEnd);
      base.setHours(sh, sm, 0, 0);
      s = base.getTime();
      if (s < prevEnd - 60 * 60000) s += 24 * 3600000;
    }
    const durMin = ((eh * 60 + em) - (sh * 60 + sm) + 24 * 60) % (24 * 60) || 12 * 60;
    const e = s + durMin * 60000;
    out.push({ startMs: s, endMs: e });
    prevEnd = e;
  });
  return out;
}

function sanitize(s: string): string {
  try {
    return decodeURIComponent(escape(s || ''))
      .replace(/[^\x20-\xFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return String(s || '')
      .replace(/[^\x20-\xFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function fuenteHistorica(opts: {
  cerrado: boolean;
  checkInSource: string;
  checkOutSource: string;
  presenciaSource: string;
  checkInMethod: string;
  autoPresencia: boolean;
  autoCompleted: boolean;
}): FuenteMarca {
  if (opts.cerrado) {
    const out = opts.checkOutSource.toUpperCase();
    if (out === 'WA' || out === 'WHATSAPP') return 'WA';
    if (out === 'AUTO' || out === 'SISTEMA' || out === 'SYSTEM' || opts.autoCompleted) return 'Auto';
    if (out === 'MANUAL_RADIO' || out.includes('RADIO')) return 'Radio';
    if (out === 'PORTAL_GPS' || out === 'APP_GEO' || out === 'APP_QR') return 'App';
    if (out === 'MANUAL' || out === 'OPERATIONS' || out === 'MANUAL_PHONE') return 'Op';
    if (out === 'MODO_DEMO' || out === 'DEMO') return 'Demo';
    return '—';
  }
  const src = (opts.presenciaSource || opts.checkInMethod || opts.checkInSource).toUpperCase();
  if (src === 'MODO_DEMO' || src === 'DEMO' || opts.autoPresencia) return 'Demo';
  if (src === 'PORTAL_GPS' || src === 'APP_GEO' || src === 'APP_QR') return 'App';
  if (src === 'MANUAL_RADIO' || src.includes('RADIO')) return 'Radio';
  if (src === 'WA' || src === 'WHATSAPP') return 'WA';
  if (src === 'MANUAL' || src === 'OPERATIONS' || src === 'MANUAL_PHONE') return 'Op';
  return '—';
}

function difHistorico(ingP: string, ingR: string, estado: string): string {
  if (estado === 'AUSENTE') return '—';
  if (!ingR || ingR === '—') return '—';
  const exp = parseHHMMToMins(ingP);
  const re = parseHHMMToMins(ingR);
  if (exp === null || re === null) return '—';
  const diff = re - exp;
  if (diff > PUNTUAL_HASTA_MIN) return `+${diff} min`;
  if (diff < 0) return `${diff} min antes`;
  return 'puntual';
}

function estadoLabel(status: string, tieneIngreso: boolean): string {
  const st = status.toUpperCase();
  if (st === 'COMPLETED') return 'CERRADO';
  if (st === 'ABSENT') return 'AUSENTE';
  if (st === 'PRESENT' || tieneIngreso) return 'PRESENTE';
  return 'ESPERANDO';
}

function esAutoCompleted(shift: Record<string, unknown>): boolean {
  return (
    !!shift.autoCompletedAt
    || shift.autoCierre === true
    || String(shift.autoCompletedBy || '').length > 0
    || String(shift.completionReason || '').toUpperCase().startsWith('FIN_')
    || String(shift.completionReason || '').toUpperCase().startsWith('SIN_')
    || String(shift.checkOutSource || '').toUpperCase() === 'AUTO'
  );
}

function perteneceEmpresa(
  shift: Record<string, unknown>,
  empresaId: string,
  scopeEmpresa: boolean,
): boolean {
  if (
    (!scopeEmpresa || empresaId.toLowerCase() === 'bacarsa')
    && shift.empresaId
    && String(shift.empresaId).trim() !== ''
    && String(shift.empresaId).trim().toLowerCase() !== empresaId.toLowerCase()
  ) {
    return false;
  }
  return true;
}

function buildObjMap(docs: QueryDocumentSnapshot[]): Map<string, ObjInfo> {
  const m = new Map<string, ObjInfo>();
  docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name || '').trim();
    const objs = Array.isArray(data.objetivos)
      ? (data.objetivos as Record<string, unknown>[])
      : [];
    objs.forEach((o) => {
      const key = String(o.id || o.objectiveId || '').trim();
      if (!key) return;
      m.set(key, {
        name: String(o.name || '').trim() || key,
        clientName: clientName || 'Sin cliente',
      });
    });
  });
  return m;
}

/** Texto de cobertura: quién cubre al titular, o a quién cubre este guardia. */
function textoCobertura(
  shift: Record<string, unknown>,
  coberturaPorTitular: Map<string, string[]>,
  docId: string,
): string {
  const partes: string[] = [];
  const origin = String(shift.origin || '').toUpperCase();
  const covers = String(shift.coversEmployeeName || '').trim();
  if (origin === 'OPERATIONS_COVERAGE' && covers) {
    partes.push(`Cubre a ${covers}`);
  }

  const cubiertoPorDoc = String(shift.coveringDisplayName || shift.coveredByEmployeeName || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  const cubierto =
    shift.operacionallyCovered === true
    || String(shift.coverageStatus || '').toUpperCase() === 'COVERED';
  if (cubierto && cubiertoPorDoc) {
    partes.push(`Cubierto por ${cubiertoPorDoc}`);
  }

  const links = coberturaPorTitular.get(docId);
  if (links && links.length > 0) {
    const lista = links.join(', ');
    if (!partes.some((p) => p.includes(lista))) {
      partes.push(`Cubierto por ${lista}`);
    }
  }

  // Dedup suave
  return [...new Set(partes)].join(' · ');
}

function mapearFilas(
  docs: QueryDocumentSnapshot[],
  empresaId: string,
  scopeEmpresa: boolean,
  ymd: string,
  objMap: Map<string, ObjInfo>,
): RowPdf[] {
  const dayStart = arHmOnYmdMs(ymd, 0, 0);
  const dayEnd = arHmOnYmdMs(ymd, 23, 59) + 59 * 1000;

  // Primero: vínculos de cobertura (incluye EXT/ADV con hoursOnSource).
  const coberturaPorTitular = new Map<string, string[]>();
  const registrarCoberturaLink = (shift: Record<string, unknown>, employeeName: string) => {
    if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return;
    if (shift.coverageSuperseded === true || shift.isDeleted === true) return;
    if (String(shift.status || '').toUpperCase() === 'CANCELLED') return;
    const forId = String(
      shift.coverageForShiftId || shift.coveredShiftId || shift.absenceShiftId || '',
    ).trim();
    const quien = String(employeeName || shift.employeeName || '').trim();
    if (!forId || !quien) return;
    const prev = coberturaPorTitular.get(forId) || [];
    if (!prev.includes(quien)) coberturaPorTitular.set(forId, [...prev, quien]);
  };

  for (const d of docs) {
    const shift = d.data() as Record<string, unknown>;
    if (!perteneceEmpresa(shift, empresaId, scopeEmpresa)) continue;
    registrarCoberturaLink(shift, String(shift.employeeName || '').trim());
  }

  const rows: RowPdf[] = [];

  for (const d of docs) {
    const shift = d.data() as Record<string, unknown>;
    if (!perteneceEmpresa(shift, empresaId, scopeEmpresa)) continue;
    if (shift.draft === true) continue;
    if (
      shift.isDeleted === true
      || shift.coverageSuperseded === true
      || String(shift.status || '').toUpperCase() === 'CANCELLED'
    ) {
      continue;
    }
    // EXT/ADV con horas en el propio turno: no hay fila aparte, el vínculo ya se registró arriba.
    if (shift.coverageHoursOnSource === true) continue;

    const employeeName = String(shift.employeeName || '').trim();
    const employeeId = String(shift.employeeId || '');
    if (employeeId === 'VACANTE' || !employeeName) continue;

    const code = String(shift.code || '').toUpperCase();
    if (
      isRestFrancoShift({
        code,
        isFranco: shift.isFranco,
        isFrancoTrabajado: shift.isFrancoTrabajado,
        isFrancoCompensatorio: shift.isFrancoCompensatorio,
        objectiveName: shift.objectiveName,
        type: shift.type,
      })
    ) {
      continue;
    }
    if (SKIP_CODES.has(code)) continue;

    const startMs = toStartMs(shift.startTime);
    if (Number.isNaN(startMs)) continue;
    if (startMs < dayStart - 6 * 3600000 || startMs > dayEnd + 6 * 3600000) continue;
    if (arYmd(startMs) !== ymd) continue;

    const objectiveId = String(shift.objectiveId || '').trim();
    const objInfo = objectiveId ? objMap.get(objectiveId) : undefined;
    const objetivo =
      objInfo?.name
      || String(shift.objectiveName || '').trim()
      || '—';
    const cliente =
      objInfo?.clientName
      || String(shift.clientName || shift.clienteNombre || '').trim()
      || 'Sin cliente';
    const puesto = String(shift.positionName || '—');
    const comentario = String(shift.comentarioOps || '').trim();
    const comentarioPor = String(shift.comentarioOpsPor || '').trim();
    const comentarioFull = comentario
      ? (comentarioPor ? `${comentario} (${comentarioPor})` : comentario)
      : '';
    const cobertura = textoCobertura(shift, coberturaPorTitular, d.id);

    const esMarca = (v: unknown): v is Timestamp =>
      !!v && typeof (v as { toMillis?: unknown }).toMillis === 'function';
    const finAjustado =
      shift.isExtended === true && esMarca(shift.adjustedEndTime) ? shift.adjustedEndTime : undefined;
    const inicioAjustado =
      shift.isEarlyStart === true && esMarca(shift.adjustedStartTime) ? shift.adjustedStartTime : undefined;
    const retiroAnticipado = shift.completionReason === 'EARLY_WITHDRAW';
    const endTs = (
      retiroAnticipado && shift.plannedEndTime
        ? shift.plannedEndTime
        : finAjustado ?? shift.endTime
    ) as Timestamp | undefined;
    const startTs = (inicioAjustado ?? shift.startTime) as Timestamp;
    const realTs = shift.realStartTime as Timestamp | undefined;
    const realEnd = shift.realEndTime as Timestamp | undefined;
    const docStatus = String(shift.status || 'PENDING').toUpperCase();
    const cerradoDoc = docStatus === 'COMPLETED' || shift.isCompleted === true;
    const autoPresencia = shift.autoPresencia === true || !!shift.modoDemoAt;
    const autoCompleted = esAutoCompleted(shift);

    const pushRow = (partial: Omit<RowPdf, 'cliente' | 'objetivo' | 'cobertura' | 'comentario'>) => {
      rows.push({
        ...partial,
        cliente,
        objetivo,
        cobertura,
        comentario: comentarioFull,
      });
    };

    const bloques = bloquesDelTurno(shift.blocks);
    if (bloques) {
      const pb = (shift.presenciaBloques && typeof shift.presenciaBloques === 'object'
        ? shift.presenciaBloques
        : {}) as Record<string, Record<string, unknown> | undefined>;
      const tramos = tramosDeTurno(startMs, bloques);
      const docEndMs = toStartMs(shift.realEndTime);
      tramos.forEach((tr, i) => {
        const n = i + 1;
        const p = pb[`b${n}`] || {};
        const realIni = i === 0 ? realTs : (p.realStartTime as Timestamp | undefined);
        const realFin = (p.realEndTime as Timestamp | undefined)
          || (cerradoDoc && i === tramos.length - 1 ? realEnd : undefined);
        const tramoCerrado =
          p.cerrado === true
          || (cerradoDoc && (i === 0 || Number.isNaN(docEndMs) || docEndMs >= tr.startMs));
        let status = 'PENDING';
        if (tramoCerrado) status = 'COMPLETED';
        else if (docStatus === 'ABSENT') status = 'ABSENT';
        else if (i === 0) status = docStatus === 'PRESENT' && !realTs ? 'PENDING' : docStatus;
        else status = realIni ? 'PRESENT' : 'PENDING';

        const ingP = formatHHMM(Timestamp.fromMillis(tr.startMs));
        const egrP = formatHHMM(Timestamp.fromMillis(tr.endMs));
        const ingR = realIni ? formatHHMM(realIni) : '—';
        const egrR = realFin ? formatHHMM(realFin) : '—';
        const estado = estadoLabel(status, !!realIni);
        const fuente = fuenteHistorica({
          cerrado: tramoCerrado,
          checkInSource: i === 0 ? String(shift.checkInSource || '') : String(p.checkInSource || ''),
          checkOutSource: i === 0 ? String(shift.checkOutSource || '') : String(p.checkOutSource || ''),
          presenciaSource: i === 0 ? String(shift.presenciaSource || '') : '',
          checkInMethod: i === 0 ? String(shift.checkInMethod || '') : '',
          autoPresencia,
          autoCompleted,
        });
        pushRow({
          guardia: `${employeeName} [${n}/${tramos.length}]`,
          puesto,
          codigo: code || '—',
          ingP,
          ingR,
          egrP,
          egrR,
          dif: difHistorico(ingP, ingR, estado),
          fuente,
          estado,
          startMs: tr.startMs,
        });
      });
      continue;
    }

    const ingP = formatHHMM(startTs);
    const egrP = formatHHMM(endTs);
    const ingR = realTs ? formatHHMM(realTs) : '—';
    const egrR = realEnd ? formatHHMM(realEnd) : '—';
    const estado = estadoLabel(docStatus, !!realTs);
    const fuente = fuenteHistorica({
      cerrado: cerradoDoc,
      checkInSource: String(shift.checkInSource || ''),
      checkOutSource: String(shift.checkOutSource || ''),
      presenciaSource: String(shift.presenciaSource || ''),
      checkInMethod: String(shift.checkInMethod || ''),
      autoPresencia,
      autoCompleted,
    });
    pushRow({
      guardia: employeeName,
      puesto,
      codigo: code || '—',
      ingP,
      ingR,
      egrP,
      egrR,
      dif: difHistorico(ingP, ingR, estado),
      fuente,
      estado,
      startMs,
    });
  }

  rows.sort((a, b) => {
    const c = a.cliente.localeCompare(b.cliente, 'es');
    if (c !== 0) return c;
    const o = a.objetivo.localeCompare(b.objetivo, 'es');
    if (o !== 0) return o;
    return a.startMs - b.startMs;
  });
  return rows;
}

function fmtFechaLarga(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
  return dt.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtFechaCorta(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export type GenerarModoRapidoPdfArgs = {
  empresaId: string;
  scopeEmpresa: boolean;
  empresaNombre: string;
  /** YYYY-MM-DD */
  ymd: string;
};

export type GenerarModoRapidoPdfResult = {
  filas: number;
  fileName: string;
};

/**
 * Consulta turnos del día AR pedido y descarga `modo-rapido_YYYY-MM-DD.pdf`.
 */
export async function generarModoRapidoReportePdf(
  args: GenerarModoRapidoPdfArgs,
): Promise<GenerarModoRapidoPdfResult> {
  const empresaId = String(args.empresaId || '').trim();
  if (!empresaId) throw new Error('Sin empresa');
  const ymd = String(args.ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error('Fecha inválida');

  const startBound = Timestamp.fromMillis(arHmOnYmdMs(ymd, 0, 0) - 6 * 3600000);
  const endBound = Timestamp.fromMillis(arHmOnYmdMs(ymd, 23, 59) + 6 * 3600000);

  const [clientsSnap, turnosSnap] = await Promise.all([
    getDocs(empresaCollectionQuery('clients', empresaId, args.scopeEmpresa)),
    getDocs(
      query(
        empresaCollectionQuery('turnos', empresaId, args.scopeEmpresa),
        where('startTime', '>=', startBound),
        where('startTime', '<=', endBound),
      ),
    ),
  ]);

  const objMap = buildObjMap(clientsSnap.docs);
  const rows = mapearFilas(turnosSnap.docs, empresaId, args.scopeEmpresa, ymd, objMap);
  if (rows.length === 0) {
    throw new Error(`Sin turnos operativos el ${fmtFechaCorta(ymd)}`);
  }

  const presentes = rows.filter((r) => r.estado === 'PRESENTE').length;
  const cerrados = rows.filter((r) => r.estado === 'CERRADO').length;
  const ausentes = rows.filter((r) => r.estado === 'AUSENTE').length;
  const conCobertura = rows.filter((r) => r.cobertura).length;
  const conComentario = rows.filter((r) => r.comentario).length;
  const clientesUnicos = new Set(rows.map((r) => r.cliente)).size;
  const objetivosUnicos = new Set(rows.map((r) => `${r.cliente}|${r.objetivo}`)).size;

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const COLS = 12;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageW, 16, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('CC Modo Rapido — Parte diario', 10, 10);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(sanitize(args.empresaNombre || empresaId), pageW / 2, 10, { align: 'center' });
  pdf.text(fmtFechaLarga(ymd).toUpperCase(), pageW - 10, 10, { align: 'right' });

  pdf.setTextColor(51, 65, 85);
  pdf.setFontSize(7.5);
  pdf.text(
    `Total ${rows.length}  ·  Clientes ${clientesUnicos}  ·  Objetivos ${objetivosUnicos}  ·  Presentes ${presentes}  ·  Cerrados ${cerrados}  ·  Ausentes ${ausentes}  ·  Coberturas ${conCobertura}  ·  Comentarios ${conComentario}`,
    10,
    22,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = [];
  let lastCliente = '';
  let lastObj = '';
  for (const r of rows) {
    if (r.cliente !== lastCliente) {
      lastCliente = r.cliente;
      lastObj = '';
      body.push([
        {
          content: `CLIENTE · ${sanitize(r.cliente)}`,
          colSpan: COLS,
          styles: {
            fillColor: [30, 41, 59],
            fontStyle: 'bold',
            textColor: [255, 255, 255],
            fontSize: 8,
          },
        },
      ]);
    }
    if (r.objetivo !== lastObj) {
      lastObj = r.objetivo;
      body.push([
        {
          content: `Objetivo · ${sanitize(r.objetivo)}`,
          colSpan: COLS,
          styles: {
            fillColor: [226, 232, 240],
            fontStyle: 'bold',
            textColor: [30, 41, 59],
            fontSize: 7.5,
          },
        },
      ]);
    }
    body.push([
      sanitize(r.guardia),
      sanitize(r.puesto),
      r.codigo,
      r.ingP,
      r.ingR,
      r.egrP,
      r.egrR,
      r.dif,
      r.fuente,
      r.estado,
      sanitize(r.cobertura || '—'),
      sanitize(r.comentario || '—'),
    ]);
  }

  autoTable(pdf, {
    startY: 26,
    head: [[
      'Guardia', 'Puesto', 'Cod', 'Ing. P.', 'Ing. R.', 'Egr. P.', 'Egr. R.',
      'Dif', 'Fuente', 'Estado', 'Cobertura', 'Comentario',
    ]],
    body,
    styles: { fontSize: 6.5, cellPadding: 1.1, overflow: 'linebreak', valign: 'middle' },
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 20 },
      2: { cellWidth: 12 },
      3: { cellWidth: 13, halign: 'center', font: 'courier' },
      4: { cellWidth: 13, halign: 'center', font: 'courier', fontStyle: 'bold' },
      5: { cellWidth: 13, halign: 'center', font: 'courier' },
      6: { cellWidth: 13, halign: 'center', font: 'courier', fontStyle: 'bold' },
      7: { cellWidth: 16 },
      8: { cellWidth: 12, halign: 'center' },
      9: { cellWidth: 16, halign: 'center' },
      10: { cellWidth: 38 },
      11: { cellWidth: 38 },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (Array.isArray(data.row.raw) && data.row.raw.length === 1) return;
      if (data.column.index === 9) {
        const v = String(data.cell.raw || '');
        if (v === 'AUSENTE') data.cell.styles.textColor = [220, 38, 38];
        if (v === 'CERRADO') data.cell.styles.textColor = [71, 85, 105];
        if (v === 'PRESENTE') data.cell.styles.textColor = [5, 150, 105];
      }
      if (data.column.index === 8 && String(data.cell.raw) === 'Auto') {
        data.cell.styles.textColor = [100, 116, 139];
      }
      if (data.column.index === 10 && String(data.cell.raw || '') !== '—') {
        data.cell.styles.textColor = [109, 40, 217];
      }
      if (data.column.index === 11 && String(data.cell.raw || '') !== '—') {
        data.cell.styles.textColor = [67, 56, 202];
      }
    },
    margin: { left: 8, right: 8 },
  });

  const totalPages = (pdf as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  const generado = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(7);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Generado ${generado} · sin archivo en servidor`, 8, pageH - 5);
    pdf.text(`Pagina ${i} / ${totalPages}`, pageW - 8, pageH - 5, { align: 'right' });
  }

  const fileName = `modo-rapido_${ymd}.pdf`;
  pdf.save(fileName);
  return { filas: rows.length, fileName };
}

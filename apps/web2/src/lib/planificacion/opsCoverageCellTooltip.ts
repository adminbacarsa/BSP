type TsLike = { toDate?: () => Date; seconds?: number } | Date | string | null | undefined;

function tsToDate(input: TsLike): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === 'object' && typeof input.toDate === 'function') {
    const d = input.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'object' && typeof input.seconds === 'number') {
    return new Date(input.seconds * 1000);
  }
  if (typeof input === 'string') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function fmtClock(input: TsLike): string | null {
  const d = tsToDate(input);
  if (!d) return null;
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const SEGMENT_LABELS: Record<string, string> = {
  TARGET: 'Titular del hueco',
  EXTENSION: 'Extensión 12h',
  EARLY_START: 'Adelanto de turno',
  LIBERATED: 'Retención liberada',
};

const COVERAGE_TYPE_LABELS: Record<string, string> = {
  RET: 'Retención activada',
  FT: 'Franco trabajado',
  COBERTURA: 'Cobertura operativa',
  EXT: 'Extensión de jornada',
  EXTENSION: 'Extensión 12h',
  EARLY_START: 'Adelanto de turno',
  VOLANTE: 'Volante / sin turno previo',
  SIN_TURNO: 'Sin turno en malla',
  ESC: 'Escuela redirigida',
  MANUAL: 'Asignación manual (CC)',
};

function labelCoverageType(raw: string | undefined | null): string | null {
  const u = String(raw || '').trim().toUpperCase();
  if (!u) return null;
  return COVERAGE_TYPE_LABELS[u] || raw || null;
}

function opsRuntimeLabel(shift: Record<string, unknown>): string {
  if (shift.isPresent === true) return 'Presente en puesto';
  if (shift.isCompleted === true) return 'Turno completado';
  if (shift.isAbsent === true) return 'Ausente';
  const st = String(shift.status || '').toUpperCase();
  if (st === 'PRESENT' || st === 'COMPLETED') return st === 'COMPLETED' ? 'Completado' : 'Presente';
  if (st === 'ABSENT') return 'Ausente';
  if (st === 'PENDING') return 'Pendiente (sin fichar)';
  if (st === 'COVERED') return 'Hueco cubierto (titular)';
  return st || '—';
}

export type OpsCoverageTooltipContext = {
  /** Guardia de la fila (quien ejecuta la cobertura). */
  coverGuardName?: string | null;
  getEmployeeName?: (employeeId: string) => string | null | undefined;
  /** Turno titular / ausente / vacante vinculado (absenceShiftId). */
  titularShift?: Record<string, unknown> | null;
};

function resolveTitularName(
  shift: Record<string, unknown>,
  ctx?: OpsCoverageTooltipContext,
): string | null {
  const fromField =
    String(shift.coversEmployeeName || '').trim()
    || (shift.coversEmployeeId && ctx?.getEmployeeName
      ? String(ctx.getEmployeeName(String(shift.coversEmployeeId)) || '').trim()
      : '')
    || (shift.coversEmployeeId ? `Legajo ${String(shift.coversEmployeeId)}` : '');
  if (fromField) return fromField;

  const tit = ctx?.titularShift;
  if (tit) {
    const tn =
      String(tit.employeeName || '').trim()
      || (tit.employeeId && ctx?.getEmployeeName
        ? String(ctx.getEmployeeName(String(tit.employeeId)) || '').trim()
        : '')
      || (tit.employeeId === 'VACANTE' || !tit.employeeId ? 'Vacante / hueco SLA' : '');
    if (tn) return tn;
  }
  return null;
}

function resolveCoverGuardName(shift: Record<string, unknown>, ctx?: OpsCoverageTooltipContext): string | null {
  const row = String(ctx?.coverGuardName || '').trim();
  if (row) return row;
  const en = String(shift.employeeName || '').trim();
  if (en) return en;
  if (shift.employeeId && ctx?.getEmployeeName) {
    const n = ctx.getEmployeeName(String(shift.employeeId));
    if (n) return String(n).trim();
  }
  return shift.employeeId ? `Legajo ${String(shift.employeeId)}` : null;
}

/** Texto multilínea para tooltip / detalle de celda COB en planificación publicada. */
export function buildOpsCoverageCellTooltip(
  shift: Record<string, unknown> | null | undefined,
  ctx?: OpsCoverageTooltipContext,
): string {
  if (!shift) return 'Cobertura desde Operaciones';

  const lines: string[] = ['Cobertura desde Centro de Operaciones', 'Solo lectura en cronograma publicado'];

  const coverGuard = resolveCoverGuardName(shift, ctx);
  if (coverGuard) lines.push(`Guardia que cubre: ${coverGuard}`);

  const titular = resolveTitularName(shift, ctx);
  if (titular) lines.push(`Titular / hueco: ${titular}`);

  const tit = ctx?.titularShift;
  if (tit) {
    const titCode = String(tit.code || tit.type || '').trim();
    if (titCode) lines.push(`Turno titular planificado: ${titCode.toUpperCase()}`);
    const absType = String(tit.absenceType || tit.name || '').trim();
    if (tit.isAbsent === true || String(tit.status || '').toUpperCase() === 'ABSENT') {
      lines.push(`Situación titular: Ausente${absType ? ` (${absType})` : ''}`);
    } else if (!tit.employeeId || tit.employeeId === 'VACANTE') {
      lines.push('Situación titular: Vacante sin asignar');
    }
    const titPos = String(tit.positionName || '').trim();
    if (titPos && !String(shift.coversPositionName || shift.positionName || '').includes(titPos)) {
      lines.push(`Puesto titular: ${titPos}`);
    }
  }

  const band = String(shift.coversBandCode || shift.deploymentBand || shift.code || '').trim();
  if (band) lines.push(`Banda cubierta: ${band.toUpperCase()}`);

  const pos = String(shift.coversPositionName || shift.positionName || '').trim();
  if (pos) lines.push(`Puesto: ${pos}`);

  const seg = String(shift.coverageSegmentRole || '').toUpperCase();
  if (seg && SEGMENT_LABELS[seg]) lines.push(`Tipo: ${SEGMENT_LABELS[seg]}`);

  const covType =
    labelCoverageType(String(shift.coverageType || ''))
    || (shift.isFrancoTrabajado === true ? 'Franco trabajado' : null)
    || (shift.isRetentionActivated === true ? 'Retención activada' : null);
  if (covType) lines.push(`Mecanismo: ${covType}`);

  const mode = String(shift.coverageMode || '').trim();
  if (mode) lines.push(`Modo: ${mode}`);

  const planStart = fmtClock(shift.startTime as TsLike);
  const planEnd = fmtClock(shift.endTime as TsLike);
  if (planStart && planEnd) lines.push(`Horario plan: ${planStart} – ${planEnd}`);

  const realStart = fmtClock(shift.realStartTime as TsLike);
  const realEnd = fmtClock(shift.realEndTime as TsLike);
  if (realStart || realEnd) {
    lines.push(`Horario real: ${realStart || '—'} – ${realEnd || '—'}`);
  }

  lines.push(`Estado ops: ${opsRuntimeLabel(shift)}`);

  const covSt = String(shift.coverageStatus || '').trim();
  if (covSt) lines.push(`Cobertura: ${covSt}`);

  const note = String(shift.coverageNote || shift.comments || '').trim();
  if (note) lines.push(`Detalle: ${note.slice(0, 240)}`);

  const resolved = String(shift.resolvedBy || '').trim();
  if (resolved) lines.push(`Registrado por: ${resolved}`);

  const convId = String(shift.assignedByConvocatoria || shift.coverageConvocatoriaId || '').trim();
  if (convId) lines.push(`Ref. convocatoria: ${convId.slice(0, 12)}…`);

  if (shift.coverageSuperseded === true) {
    lines.push('⚠ Cobertura reemplazada por otra posterior');
  }

  return lines.join('\n');
}

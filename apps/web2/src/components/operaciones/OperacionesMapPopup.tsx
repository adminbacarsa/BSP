import React, { useMemo, useState } from 'react';
import type { OperacionesMapMarker } from '@/hooks/useOperacionesMapMarkers';
import { opsShiftDayLabel } from '@/hooks/useOperacionesMonitor';
import { ShiftCodeBadge } from '@/components/operaciones/ShiftCodeBadge';
import { SinNotificacionesMark } from '@/components/operaciones/SinNotificacionesMark';
import { canRevertAbsenceNow } from '@/lib/operaciones/revertAbsenceWindow';
import { formatRetentionDuration, formatRetentionLine, estadoAusenciaCc } from '@cosp/ops-core';
import { ESTADO_AUSENCIA_HEX } from '@/components/operaciones/EstadoAusenciaChip';
import { estadoGuardiaEvento, eventServicioLabel } from '@/lib/operaciones/eventoCc';
import { REVERTIR_VENCIDO_TEXTO } from '@/lib/operaciones/guardCardEstado';

const getRefuerzoLabel = (shift: any): 'RFZ' | 'TURA' | null => {
  const code = String(shift?.code || '').toUpperCase();
  if (code === 'RFZ' || shift?.isRfzVacante) return 'RFZ';
  if (code === 'TURA') return 'TURA';
  const type = String(shift?.type || '').toUpperCase();
  if (type === 'RFZ') return 'RFZ';
  if (type === 'TURA') return 'TURA';
  return null;
};

const getShiftStatusStyle = (shift: any, diffMin: number): { borderColor: string; background: string; avatarBg: string } => {
  if (shift.isUnassigned) return { borderColor: '#e11d48', background: '#fff1f2', avatarBg: '#fda4af' };
  if (shift.isFranco) return { borderColor: '#3b82f6', background: '#eff6ff', avatarBg: '#93c5fd' };
  if (shift.isPresent) return { borderColor: '#10b981', background: '#f0fdf4', avatarBg: '#6ee7b7' };
  if (shift.isAbsent || shift.isPotentialAbsence) return { borderColor: '#f97316', background: '#fff7ed', avatarBg: '#fdba74' };
  if (!shift.isPresent && diffMin > 5) return { borderColor: '#f59e0b', background: '#fffbeb', avatarBg: '#fde68a' };
  return { borderColor: '#cbd5e1', background: '#f8fafc', avatarBg: '#e2e8f0' };
};

const getStatusPriority = (shift: any, diffMin: number): number => {
  if (shift.isUnassigned) return 0;
  if (shift.isAbsent || shift.isPotentialAbsence) return 1;
  if (!shift.isFranco && diffMin > 5) return 2;
  if (shift.isPresent) return 3;
  if (diffMin >= -15) return 4;
  if (shift.isFranco) return 6;
  return 5;
};

const toMs = (d: any): number => {
  if (!d) return 0;
  if (d.seconds) return d.seconds * 1000;
  if (d instanceof Date) return d.getTime();
  return 0;
};

const getHeaderGradient = (statusText: string, isEvent?: boolean): string => {
  if (isEvent) {
    if (statusText.includes('aus') || statusText.includes('vac')) return 'linear-gradient(135deg, #9f1239, #be123c)';
    if (statusText.includes('tarde')) return 'linear-gradient(135deg, #92400e, #b45309)';
    return 'linear-gradient(135deg, #92400e, #d97706)';
  }
  if (['VACANTE', 'AUSENCIA', 'VACANTE REPORTADA', 'DEVUELTA A PLANIF.'].includes(statusText))
    return 'linear-gradient(135deg, #9f1239, #be123c)';
  if (statusText === 'TARDE') return 'linear-gradient(135deg, #92400e, #b45309)';
  if (statusText === 'ACTIVO' || statusText === 'A TIEMPO') return 'linear-gradient(135deg, #065f46, #059669)';
  return 'linear-gradient(135deg, #1e293b, #0f172a)';
};

export type OperacionesMapPopupProps = {
  marker: OperacionesMapMarker;
  onOpenCoverage: (shift: any) => void;
  onOpenAttendance: (shift: any) => void;
  onOpenHandover: (shift: any) => void;
  onOpenInterrupt: (shift: any) => void;
  onOpenManualRetention?: (shift: any) => void;
};

export function OperacionesMapPopup({
  marker,
  onOpenCoverage,
  onOpenAttendance,
  onOpenHandover,
  onOpenInterrupt,
  onOpenManualRetention,
}: OperacionesMapPopupProps) {
  const [sortKey, setSortKey] = useState<'nombre' | 'horario' | 'puesto' | 'estado' | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const sorted = useMemo(() => {
    const now = new Date();
    const shifts = [...(marker.shifts || [])];
    if (!sortKey) return shifts;
    return shifts.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'nombre') {
        cmp = (a.employeeName || '').localeCompare(b.employeeName || '');
      } else if (sortKey === 'horario') {
        cmp = toMs(a.shiftDateObj) - toMs(b.shiftDateObj);
      } else if (sortKey === 'puesto') {
        cmp = (a.positionName || '').localeCompare(b.positionName || '');
      } else if (sortKey === 'estado') {
        const dA = (now.getTime() - toMs(a.shiftDateObj)) / 60000;
        const dB = (now.getTime() - toMs(b.shiftDateObj)) / 60000;
        cmp = getStatusPriority(a, dA) - getStatusPriority(b, dB);
      }
      return cmp * sortDir;
    });
  }, [marker.shifts, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: typeof sortKey }) => (
    <span style={{ marginLeft: '3px', fontSize: '8px', opacity: sortKey === col ? 1 : 0.35 }}>
      {sortKey === col ? (sortDir === 1 ? '▲' : '▼') : '⇅'}
    </span>
  );

  const ColHeader = ({ col, label, w }: { col: typeof sortKey; label: string; w?: string }) => (
    <span
      onClick={() => handleSort(col)}
      style={{
        flex: w ? `0 0 ${w}` : 1,
        fontSize: '8px',
        fontWeight: 800,
        color: sortKey === col ? '#4f46e5' : '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        cursor: 'pointer',
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {label}
      <SortIcon col={col} />
    </span>
  );

  return (
    <div style={{ width: 'min(560px, calc(100vw - 24px))', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }} data-ops-popup={marker.isEvent ? 'evento' : 'objetivo'}>
      <div style={{ background: getHeaderGradient(marker.statusText, marker.isEvent), borderRadius: '12px 12px 0 0', padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span
              style={{
                fontSize: '8px',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.55)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                display: 'block',
              }}
            >
              {marker.client}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 900, color: 'white', lineHeight: 1.2 }}>{marker.isEvent ? (marker.subtitle || marker.name) : marker.name}</span>
            {marker.isEvent && marker.lugar && (
              <span style={{ display: 'block', fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>Lugar: {marker.lugar}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span
              style={{
                fontSize: '8px',
                fontWeight: 800,
                color: 'white',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '999px',
                padding: '2px 8px',
                textTransform: 'uppercase',
              }}
            >
              {marker.statusText}
            </span>
            <span style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
              {marker.shifts.length} {marker.shifts.length === 1 ? 'turno' : 'turnos'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: '0 0 12px 12px', overflowY: 'auto', maxHeight: '540px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f1f5f9',
            position: 'sticky',
            top: 0,
          }}
        >
          <ColHeader col="nombre" label="Guardia" w="180px" />
          <ColHeader col="horario" label="Horario" w="100px" />
          <ColHeader col="puesto" label={marker.isEvent ? 'Servicio' : 'Puesto'} />
          <ColHeader col="estado" label="Estado" w="52px" />
          <span
            style={{
              width: '54px',
              fontSize: '8px',
              fontWeight: 800,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              flexShrink: 0,
              textAlign: 'center',
            }}
          >
            Acción
          </span>
        </div>

        {sorted.length > 0 ? (
          sorted.map((shift: any, idx: number) => {
            const now = new Date();
            const start = shift.shiftDateObj
              ? shift.shiftDateObj.seconds
                ? new Date(shift.shiftDateObj.seconds * 1000)
                : shift.shiftDateObj
              : new Date();
            const end = shift.endDateObj
              ? shift.endDateObj.seconds
                ? new Date(shift.endDateObj.seconds * 1000)
                : shift.endDateObj
              : shift.endTime
                ? shift.endTime.seconds
                  ? new Date(shift.endTime.seconds * 1000)
                  : new Date(shift.endTime)
                : null;
            const diffMin = (now.getTime() - start.getTime()) / 60000;
            const canRevertAbsence = canRevertAbsenceNow(shift, now.getTime());
            const canCheckIn = (diffMin >= -15 && diffMin <= 60 && !shift.isPresent) || canRevertAbsence;
            const s = getShiftStatusStyle(shift, diffMin);
            const t1 = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
            const t2 = end ? end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
            const dayTag = opsShiftDayLabel(start, now);

            let statusLabel = 'PLAN';
            let statusColor = '#94a3b8';
            const refuerzoLabel = getRefuerzoLabel(shift);
            // Ausencia: un solo estado (mismo criterio que la lista del CC y el celular); manda la cobertura.
            const estadoAus = estadoAusenciaCc(shift);
            if (shift.isFranco) {
              statusLabel = 'FRANCO';
              statusColor = '#3b82f6';
            } else if (estadoAus) {
              statusLabel = estadoAus.kind === 'CUBIERTO' ? 'AUS · CUB'
                : estadoAus.kind === 'CUBRIENDO' ? 'AUS · CONV'
                : estadoAus.kind === 'PARCIAL' ? 'PARCIAL'
                : 'AUS · SIN CUBRIR';
              statusColor = ESTADO_AUSENCIA_HEX[estadoAus.tone];
            } else if (shift.isSinCobertura && shift.isUnassigned) {
              statusLabel = 'SIN COB.';
              statusColor = '#475569';
            } else if (shift.isPresent && shift.manualRetentionType === 'extended') {
              statusLabel = `+${shift.manualRetentionHours}h MAN`;
              statusColor = '#d97706';
            } else if (shift.isPresent && shift.manualRetentionType === 'open') {
              statusLabel = 'MAN INDEF';
              statusColor = '#d97706';
            } else if (shift.isRetention) {
              const mins = Number(shift.retentionMinutes) || 0;
              statusLabel = mins > 0 ? `RETENIDO ${formatRetentionDuration(mins)}` : 'RETENIDO';
              statusColor = '#ea580c';
            } else if (shift.cierreSinFranja) {
              statusLabel = String(shift.cierreSinFranja);
              statusColor = '#64748b';
            } else if (shift.isPendingClose) {
              const mins = Number(shift.retentionMinutes) || 0;
              statusLabel = mins > 0 ? `ESPERA RELEVO ${formatRetentionDuration(mins)}` : 'ESPERA RELEVO';
              statusColor = '#ea580c';
            } else if (shift.isPresent) {
              statusLabel = 'ACTIVO';
              statusColor = '#059669';
            } else if (shift.isAbsent) {
              statusLabel = 'AUSENTE';
              statusColor = '#64748b';
            } else if (shift.isUnassigned && shift.isReportedToPlanning) {
              statusLabel = 'DEVUELTA';
              statusColor = '#7c3aed';
            } else if (shift.isUnassigned) {
              statusLabel = 'VACANTE';
              statusColor = '#e11d48';
            } else if (shift.isProvisionalLateAbsence) {
              statusLabel = 'NO LLEGÓ / posible ausencia';
              statusColor = '#d97706';
            } else if (shift.isPotentialAbsence) {
              statusLabel = 'AUSENCIA';
              statusColor = '#dc2626';
            } else if (diffMin > 5) {
              statusLabel = 'TARDE';
              statusColor = '#d97706';
            } else if (diffMin >= -15) {
              statusLabel = 'EN HORA';
              statusColor = '#4f46e5';
            }
            if (refuerzoLabel && !estadoAus) {
              statusLabel = shift.isUnassigned ? `VAC ${refuerzoLabel}` : refuerzoLabel;
              statusColor = refuerzoLabel === 'TURA' ? '#7c3aed' : '#dc2626';
            }
            // Evento: presente / sin fichar / tarde / ausente (igual en el CC y en el celular).
            const estadoEvento = marker.isEvent ? estadoGuardiaEvento(shift, now) : null;
            if (estadoEvento && !shift.isRetention && !shift.isPendingClose && !shift.manualRetentionType) {
              statusLabel = estadoEvento.label;
              statusColor = estadoEvento.color;
            }

            const displayName =
              refuerzoLabel && !shift.isUnassigned ? `${shift.employeeName || 'VACANTE'}` : shift.employeeName || 'VACANTE';

            return (
              <div
                key={shift.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: (shift.isPresent && shift.retentionWait) || shift.relevoAusenteAviso || estadoAus?.detalle ? 'wrap' : 'nowrap',
                  gap: '6px',
                  borderLeft: `3px solid ${s.borderColor}`,
                  background: idx % 2 === 0 ? s.background : '#ffffff',
                  padding: '3px 12px',
                  minHeight: '28px',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <span
                  style={{
                    flex: '0 0 180px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#1e293b',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {refuerzoLabel && (
                    <span
                      style={{
                        fontSize: '8px',
                        fontWeight: 900,
                        color: 'white',
                        background: refuerzoLabel === 'TURA' ? '#7c3aed' : '#dc2626',
                        borderRadius: '4px',
                        padding: '1px 4px',
                        flexShrink: 0,
                      }}
                    >
                      {refuerzoLabel}
                    </span>
                  )}
                  <SinNotificacionesMark shift={shift} size={11} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                </span>
                <span
                  style={{
                    flex: '0 0 120px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#334155',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dayTag.key !== 'hoy' && (
                    <span style={{
                      color: dayTag.key === 'manana' ? '#0284c7' : '#d97706',
                      fontWeight: 900,
                      fontFamily: 'inherit',
                      marginRight: 4,
                      fontSize: 9,
                    }}>{dayTag.label}</span>
                  )}
                  {t1}
                  {t2 ? `–${t2}` : ''}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: '10px',
                    color: '#64748b',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    minWidth: 0,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{marker.isEvent ? eventServicioLabel(shift) : (shift.positionName || '—')}</span>
                  <ShiftCodeBadge shift={shift} />
                </span>
                <span
                  data-ops-estado={estadoEvento ? estadoEvento.estado : undefined}
                  data-ops-estado-ausencia={estadoAus && !estadoEvento ? estadoAus.kind : undefined}
                  title={estadoAus?.detalle || undefined}
                  style={{
                    minWidth: '52px',
                    fontSize: '8px',
                    fontWeight: 800,
                    color: 'white',
                    background: statusColor,
                    borderRadius: '4px',
                    padding: '2px 4px',
                    textAlign: 'center',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusLabel}
                </span>
                <div style={{ width: '54px', flexShrink: 0, textAlign: 'right' }}>
                  {shift.isUnassigned && !shift.isReportedToPlanning && !shift.isSinCobertura && (
                    <button
                      onClick={() => onOpenCoverage(shift)}
                      style={{
                        background: '#e11d48',
                        color: 'white',
                        fontSize: '9px',
                        fontWeight: 800,
                        padding: '3px 7px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        width: '100%',
                      }}
                    >
                      CUBRIR
                    </button>
                  )}
                  {shift.isSinCobertura && shift.isUnassigned && (
                    <span
                      style={{
                        fontSize: '8px',
                        color: '#94a3b8',
                        fontStyle: 'italic',
                        display: 'block',
                        textAlign: 'center',
                        lineHeight: 1.2,
                      }}
                    >
                      {shift.vacancyOrigin === 'ABSENCE' ? 'ausencia' : 'sin plan'}
                    </span>
                  )}
                  {estadoAus && !canRevertAbsence && end && now.getTime() > end.getTime() && (
                    <span
                      data-ops-revertir-vencido="1"
                      style={{ fontSize: '8px', color: '#94a3b8', fontStyle: 'italic', display: 'block', textAlign: 'center', lineHeight: 1.2 }}
                    >
                      {REVERTIR_VENCIDO_TEXTO}
                    </span>
                  )}
                  {!shift.isPresent && !shift.isUnassigned && !shift.isCompleted && (!shift.isAbsent || shift.isProvisionalLateAbsence || canRevertAbsence) && !shift.isFranco &&
                    (diffMin > 30 && !shift.isProvisionalLateAbsence && !canRevertAbsence ? (
                      <button
                        onClick={() => onOpenAttendance(shift)}
                        style={{
                          background: '#fef2f2',
                          color: '#be123c',
                          border: '1px solid #fecdd3',
                          fontSize: '9px',
                          fontWeight: 800,
                          padding: '3px 7px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          width: '100%',
                        }}
                      >
                        AUS.
                      </button>
                    ) : (
                      <button
                        onClick={() => onOpenHandover(shift)}
                        disabled={!canCheckIn}
                        style={{
                          background: canCheckIn ? '#4f46e5' : '#e2e8f0',
                          color: canCheckIn ? 'white' : '#94a3b8',
                          fontSize: '9px',
                          fontWeight: 800,
                          padding: '3px 7px',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: canCheckIn ? 'pointer' : 'default',
                          width: '100%',
                        }}
                      >
                        {diffMin > 5 ? 'LLEGÓ?' : 'PRES.'}
                      </button>
                    ))}
                  {(shift.isPresent || shift.status === 'PRESENT') && (
                    <button
                      onClick={() => onOpenInterrupt(shift)}
                      style={{
                        background: '#fef2f2',
                        color: '#be123c',
                        border: '1px solid #fecdd3',
                        fontSize: '9px',
                        fontWeight: 800,
                        padding: '3px 7px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        width: '100%',
                      }}
                    >
                      BAJA
                    </button>
                  )}
                  {(shift.isPresent || shift.status === 'PRESENT') && onOpenManualRetention && (
                    <button
                      onClick={() => onOpenManualRetention(shift)}
                      style={{
                        background: '#fff7ed',
                        color: '#c2410c',
                        border: '1px solid #fed7aa',
                        fontSize: '9px',
                        fontWeight: 800,
                        padding: '3px 7px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        width: '100%',
                        marginTop: '2px',
                      }}
                    >
                      RET.
                    </button>
                  )}
                </div>
                {shift.isPresent && shift.retentionWait && !shift.cierreSinFranja && (
                  <div
                    style={{
                      flex: '1 0 100%',
                      fontSize: '10px',
                      fontWeight: 700,
                      color: '#c2410c',
                      paddingLeft: '2px',
                      whiteSpace: 'normal',
                      lineHeight: 1.3,
                    }}
                  >
                    {formatRetentionLine(shift.retentionWait)}
                  </div>
                )}
                {shift.relevoAusenteAviso && (
                  <div data-relevo-ausente="1" style={{ flex: '1 0 100%', fontSize: '10px', fontWeight: 700, color: '#475569', paddingLeft: '2px', lineHeight: 1.3 }}>
                    {shift.relevoAusenteAviso}
                  </div>
                )}
                {estadoAus?.detalle && !estadoEvento && (
                  <div data-ops-ausencia-detalle={estadoAus.kind} style={{ flex: '1 0 100%', fontSize: '10px', fontWeight: 700, color: ESTADO_AUSENCIA_HEX[estadoAus.tone], paddingLeft: '2px', lineHeight: 1.3 }}>
                    {estadoAus.detalle}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: '11px', fontStyle: 'italic' }}>
            Sin actividad programada
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Shield, Clock, AlertTriangle, Siren, Navigation, UserCheck, PlayCircle, LogOut, Building2 } from 'lucide-react';

// --- ICONOS DINÁMICOS ---
const createCustomIcon = (color: string, type: 'SHIELD' | 'ALERT' | 'SIREN' | 'CHECK' | 'OFF') => {
    let svgPath = "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z";
    let innerElement = '';

    if (type === 'ALERT') innerElement = '<circle cx="12" cy="12" r="3" fill="white"/>';
    if (type === 'SIREN') innerElement = '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="white" stroke-width="2"/>';

    const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="${svgPath}" />
            ${innerElement}
            ${type === 'CHECK' ? '<path d="M9 12l2 2 4-4" stroke="white" stroke-width="3"/>' : ''}
        </svg>`;

    return L.divIcon({
        className: 'custom-icon',
        html: `<div style="width: 36px; height: 36px; filter: drop-shadow(0px 4px 4px rgba(0,0,0,0.4)); transform: translateY(-50%);">${svgString}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    });
};

const Icons = {
    GREEN: createCustomIcon('#10b981', 'CHECK'),   // Activo / A Tiempo
    YELLOW: createCustomIcon('#f59e0b', 'ALERT'),  // Tarde (5-60 min)
    RED: createCustomIcon('#e11d48', 'SIREN'),     // Ausencia (>60 min) / Crítico
    ORANGE: createCustomIcon('#f97316', 'SHIELD'), // Retención
    BLUE: createCustomIcon('#3b82f6', 'SHIELD'),   // Franco
    GRAY: createCustomIcon('#64748b', 'OFF'),      // Sin Actividad / Plan Futuro
    VIOLET: createCustomIcon('#7c3aed', 'SHIELD'), // Vacante reportada / devuelta a planificación
};

const MapUpdater = ({ markers }: any) => {
    const map = useMap();
    useEffect(() => {
        if (markers.length > 0) {
            const validMarkers = markers.filter((m: any) => m.lat != null && m.lng != null && Number.isFinite(m.lat) && Number.isFinite(m.lng));
            if (!validMarkers.length) return;
            const group = new L.FeatureGroup(validMarkers.map((m: any) => L.marker([m.lat, m.lng])));
            map.fitBounds(group.getBounds().pad(0.2));
        }
    }, [markers, map]);
    return null;
};

// --- HELPERS FOR POPUP ---
const getInitials = (name: string) => {
    if (!name || name === 'VACANTE') return '?';
    return name.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
};

const getShiftStatusStyle = (shift: any, diffMin: number): { borderColor: string; background: string; avatarBg: string } => {
    if (shift.isUnassigned)                                    return { borderColor: '#e11d48', background: '#fff1f2', avatarBg: '#fda4af' };
    if (shift.isFranco)                                        return { borderColor: '#3b82f6', background: '#eff6ff', avatarBg: '#93c5fd' };
    if (shift.isPresent)                                       return { borderColor: '#10b981', background: '#f0fdf4', avatarBg: '#6ee7b7' };
    if (shift.isAbsent || shift.isPotentialAbsence)            return { borderColor: '#f97316', background: '#fff7ed', avatarBg: '#fdba74' };
    if (!shift.isPresent && diffMin > 5)                       return { borderColor: '#f59e0b', background: '#fffbeb', avatarBg: '#fde68a' };
    return { borderColor: '#cbd5e1', background: '#f8fafc', avatarBg: '#e2e8f0' };
};

const getStatusPriority = (shift: any, diffMin: number): number => {
    if (shift.isUnassigned)                                    return 0;
    if (shift.isAbsent || shift.isPotentialAbsence)            return 1;
    if (!shift.isFranco && diffMin > 5)                        return 2;
    if (shift.isPresent)                                       return 3;
    if (diffMin >= -15)                                        return 4;
    if (shift.isFranco)                                        return 6;
    return 5;
};

const toMs = (d: any): number => {
    if (!d) return 0;
    if (d.seconds) return d.seconds * 1000;
    if (d instanceof Date) return d.getTime();
    return 0;
};

const PopupContent = ({ marker, onOpenCoverage, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenManualRetention }: any) => {
    const [sortKey, setSortKey] = useState<'nombre' | 'horario' | 'puesto' | 'estado' | null>(null);
    const [sortDir, setSortDir] = useState<1 | -1>(1);

    const handleSort = (key: typeof sortKey) => {
        if (sortKey === key) setSortDir(d => (d === 1 ? -1 : 1) as 1 | -1);
        else { setSortKey(key); setSortDir(1); }
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
            style={{ flex: w ? `0 0 ${w}` : 1, fontSize: '8px', fontWeight: 800, color: sortKey === col ? '#4f46e5' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' }}
        >
            {label}<SortIcon col={col}/>
        </span>
    );

    return (
        <div style={{ width: 'min(560px, calc(100vw - 24px))', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
            {/* HEADER */}
            <div style={{ background: getHeaderGradient(marker.statusText), borderRadius: '12px 12px 0 0', padding: '8px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <span style={{ fontSize: '8px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block' }}>{marker.client}</span>
                        <span style={{ fontSize: '13px', fontWeight: 900, color: 'white', lineHeight: 1.2 }}>{marker.name}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span style={{ fontSize: '8px', fontWeight: 800, color: 'white', background: 'rgba(255,255,255,0.2)', borderRadius: '999px', padding: '2px 8px', textTransform: 'uppercase' }}>{marker.statusText}</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{marker.shifts.length} {marker.shifts.length === 1 ? 'turno' : 'turnos'}</span>
                    </div>
                </div>
            </div>

            {/* BODY */}
            <div style={{ background: 'white', borderRadius: '0 0 12px 12px', overflowY: 'auto', maxHeight: '540px' }}>
                {/* Encabezado de columnas — clickable para sort */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderBottom: '1px solid #e2e8f0', background: '#f1f5f9', position: 'sticky', top: 0 }}>
                    <ColHeader col="nombre"  label="Guardia" w="180px"/>
                    <ColHeader col="horario" label="Horario"  w="100px"/>
                    <ColHeader col="puesto"  label="Puesto"/>
                    <ColHeader col="estado"  label="Estado" w="52px"/>
                    <span style={{ width: '54px', fontSize: '8px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0, textAlign: 'center' }}>Acción</span>
                </div>

                {sorted.length > 0 ? sorted.map((shift: any, idx: number) => {
                    const now = new Date();
                    const start = shift.shiftDateObj ? (shift.shiftDateObj.seconds ? new Date(shift.shiftDateObj.seconds * 1000) : shift.shiftDateObj) : new Date();
                    const end   = shift.endDateObj   ? (shift.endDateObj.seconds   ? new Date(shift.endDateObj.seconds * 1000)   : shift.endDateObj)   : (shift.endTime ? (shift.endTime.seconds ? new Date(shift.endTime.seconds * 1000) : new Date(shift.endTime)) : null);
                    const diffMin = (now.getTime() - start.getTime()) / 60000;
                    const canCheckIn = diffMin >= -15 && diffMin <= 60 && !shift.isPresent;
                    const s = getShiftStatusStyle(shift, diffMin);
                    const t1 = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                    const t2 = end ? end.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';

                    let statusLabel = 'PLAN'; let statusColor = '#94a3b8';
                    if (shift.isFranco)                                                       { statusLabel = 'FRANCO';   statusColor = '#3b82f6'; }
                    else if (shift.isSinCobertura)                                             { statusLabel = 'SIN COB.'; statusColor = '#475569'; }
                    else if (shift.isPresent && shift.manualRetentionType === 'extended')      { statusLabel = `+${shift.manualRetentionHours}h MAN`; statusColor = '#d97706'; }
                    else if (shift.isPresent && shift.manualRetentionType === 'open')          { statusLabel = 'MAN INDEF'; statusColor = '#d97706'; }
                    else if (shift.isRetention)                                                { statusLabel = 'RECARGO';  statusColor = '#ea580c'; }
                    else if (shift.isPresent)                                                  { statusLabel = 'ACTIVO';   statusColor = '#059669'; }
                    else if (shift.isAbsent)                                                   { statusLabel = 'AUSENTE';  statusColor = '#64748b'; }
                    else if (shift.isUnassigned && shift.isReportedToPlanning)                 { statusLabel = 'DEVUELTA'; statusColor = '#7c3aed'; }
                    else if (shift.isUnassigned)                                               { statusLabel = 'VACANTE';  statusColor = '#e11d48'; }
                    else if (shift.isPotentialAbsence)                                         { statusLabel = 'AUSENCIA'; statusColor = '#dc2626'; }
                    else if (diffMin > 5)                                                      { statusLabel = 'TARDE';    statusColor = '#d97706'; }
                    else if (diffMin >= -15)                                                   { statusLabel = 'EN HORA';  statusColor = '#4f46e5'; }

                    return (
                        <div key={shift.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: `3px solid ${s.borderColor}`, background: idx % 2 === 0 ? s.background : '#ffffff', padding: '3px 12px', minHeight: '28px', borderBottom: '1px solid #f1f5f9' }}>
                            <span style={{ flex: '0 0 180px', fontSize: '11px', fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shift.employeeName || 'VACANTE'}</span>
                            <span style={{ flex: '0 0 100px', fontSize: '10px', fontFamily: 'monospace', color: '#334155', fontWeight: 600, whiteSpace: 'nowrap' }}>{t1}{t2 ? `–${t2}` : ''}</span>
                            <span style={{ flex: 1, fontSize: '10px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shift.positionName || '—'}</span>
                            <span style={{ width: '52px', fontSize: '8px', fontWeight: 800, color: 'white', background: statusColor, borderRadius: '4px', padding: '2px 0', textAlign: 'center', flexShrink: 0 }}>{statusLabel}</span>
                            <div style={{ width: '54px', flexShrink: 0, textAlign: 'right' }}>
                                {shift.isUnassigned && !shift.isReportedToPlanning && !shift.isSinCobertura && <button onClick={() => onOpenCoverage(shift)} style={{ background: '#e11d48', color: 'white', fontSize: '9px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer', width: '100%' }}>CUBRIR</button>}
                                {shift.isSinCobertura && <span style={{ fontSize: '8px', color: '#94a3b8', fontStyle: 'italic', display: 'block', textAlign: 'center', lineHeight: 1.2 }}>{shift.vacancyOrigin === 'ABSENCE' ? 'ausencia' : 'sin plan'}</span>}
                                {!shift.isPresent && !shift.isUnassigned && !shift.isCompleted && !shift.isAbsent && !shift.isFranco && (
                                    diffMin > 30
                                        ? <button onClick={() => onOpenAttendance(shift)} style={{ background: '#fef2f2', color: '#be123c', border: '1px solid #fecdd3', fontSize: '9px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', cursor: 'pointer', width: '100%' }}>AUS.</button>
                                        : <button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} style={{ background: canCheckIn ? '#4f46e5' : '#e2e8f0', color: canCheckIn ? 'white' : '#94a3b8', fontSize: '9px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', border: 'none', cursor: canCheckIn ? 'pointer' : 'default', width: '100%' }}>{diffMin > 5 ? 'LLEGÓ?' : 'PRES.'}</button>
                                )}
                                {(shift.isPresent || shift.status === 'PRESENT') && <button onClick={() => onOpenInterrupt(shift)} style={{ background: '#fef2f2', color: '#be123c', border: '1px solid #fecdd3', fontSize: '9px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', cursor: 'pointer', width: '100%' }}>BAJA</button>}
                                {(shift.isPresent || shift.status === 'PRESENT') && onOpenManualRetention && <button onClick={() => onOpenManualRetention(shift)} style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', fontSize: '9px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', cursor: 'pointer', width: '100%', marginTop: '2px' }}>RET.</button>}
                            </div>
                        </div>
                    );
                }) : (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: '11px', fontStyle: 'italic' }}>Sin actividad programada</div>
                )}
            </div>
        </div>
    );
};

const getHeaderGradient = (statusText: string): string => {
    if (['VACANTE', 'AUSENCIA', 'VACANTE REPORTADA', 'DEVUELTA A PLANIF.'].includes(statusText))
        return 'linear-gradient(135deg, #9f1239, #be123c)';
    if (statusText === 'TARDE')
        return 'linear-gradient(135deg, #92400e, #b45309)';
    if (statusText === 'ACTIVO' || statusText === 'A TIEMPO')
        return 'linear-gradient(135deg, #065f46, #059669)';
    return 'linear-gradient(135deg, #1e293b, #0f172a)';
};

const OperacionesMap = ({
    center,
    allObjectives = [],
    filteredShifts = [],
    onOpenCoverage,
    onOpenCheckout,
    onOpenAttendance,
    onOpenHandover,
    onOpenInterrupt,
    onOpenManualRetention,
    onReportPlanning
}: any) => {

    const markers = useMemo(() => {
        const normId = (x: any) => String(x ?? '').trim();
        return allObjectives.filter((obj: any) => obj != null && obj.lat != null && obj.lng != null && Number.isFinite(Number(obj.lat)) && Number.isFinite(Number(obj.lng))).map((obj: any) => {
            const shiftsInObjective = filteredShifts.filter((s: any) => normId(s.objectiveId) === normId(obj.id));

            let icon = Icons.GRAY;
            let statusText = 'S/A';
            let priority = 0;

            if (shiftsInObjective.length > 0) {
                shiftsInObjective.forEach((s: any) => {
                    const now = new Date();
                    const start = s.shiftDateObj ? (s.shiftDateObj.seconds ? new Date(s.shiftDateObj.seconds * 1000) : s.shiftDateObj) : new Date();
                    const diffMin = (now.getTime() - start.getTime()) / 60000;
                    const isReportedOrReturned = s.isUnassigned && s.isReportedToPlanning;

                    if (isReportedOrReturned && priority < 5) {
                        const isReturned = s.status === 'UNCOVERED_REPORTED' || s.origin === 'INTERRUPTION';
                        icon = Icons.VIOLET;
                        statusText = isReturned ? 'DEVUELTA A PLANIF.' : 'VACANTE REPORTADA';
                        priority = 5;
                    } else if ((s.isUnassigned || s.isAbsent || s.isPotentialAbsence) && priority < 5) {
                        icon = Icons.RED; statusText = s.isUnassigned ? 'VACANTE' : 'AUSENCIA'; priority = 5;
                    } else if (s.isRetention && priority < 4) {
                        icon = Icons.ORANGE; statusText = 'RETENCIÓN'; priority = 4;
                    } else if (!s.isPresent && !s.isAbsent && !s.isPotentialAbsence && !s.isCompleted && !s.isFranco && diffMin > 5 && priority < 3) {
                        icon = Icons.YELLOW; statusText = 'TARDE'; priority = 3;
                    } else if ((s.isPresent || (diffMin >= -15 && diffMin <= 5 && !s.isPresent)) && priority < 2) {
                        icon = Icons.GREEN; statusText = s.isPresent ? 'ACTIVO' : 'A TIEMPO'; priority = 2;
                    } else if (s.isFranco && priority < 1) {
                        icon = Icons.BLUE; statusText = 'FRANCO'; priority = 1;
                    }
                });
            }

            const layerOrder = statusText === 'S/A' ? 0 : 1;

            return {
                id: obj.id,
                lat: obj.lat,
                lng: obj.lng,
                name: obj.name,
                client: obj.clientName || 'Cliente',
                shifts: shiftsInObjective,
                icon,
                statusText,
                hasShift: shiftsInObjective.length > 0,
                layerOrder
            };
        }).sort((a: any, b: any) => (a.layerOrder || 0) - (b.layerOrder || 0));
    }, [allObjectives, filteredShifts]);

    return (
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} className="z-0">
            <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" attribution='&copy; CARTO' />
            <MapUpdater markers={markers} />

            {markers.map((marker: any) => (
                <Marker
                    key={marker.id}
                    position={[marker.lat, marker.lng]}
                    icon={marker.icon}
                    zIndexOffset={marker.layerOrder === 0 ? 0 : 500}
                >
                    <Popup className="custom-popup">
                        <PopupContent
                            marker={marker}
                            onOpenCoverage={onOpenCoverage}
                            onOpenAttendance={onOpenAttendance}
                            onOpenHandover={onOpenHandover}
                            onOpenInterrupt={onOpenInterrupt}
                            onOpenManualRetention={onOpenManualRetention}
                        />
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
};

export default OperacionesMap;

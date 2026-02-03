import React, { useEffect, useMemo } from 'react';
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
};

const MapUpdater = ({ markers }: any) => {
    const map = useMap();
    useEffect(() => {
        if (markers.length > 0) {
            const group = new L.FeatureGroup(markers.map((m: any) => L.marker([m.lat, m.lng])));
            map.fitBounds(group.getBounds().pad(0.2));
        }
    }, [markers, map]);
    return null;
};

const OperacionesMap = ({ 
    center, 
    allObjectives = [], // LISTA MAESTRA DE OBJETIVOS (Para que se vean todos los del filtro)
    filteredShifts = [], // LISTA DE TURNOS ACTUALES (Para colorearlos)
    onOpenCoverage,
    onOpenCheckout,
    onOpenAttendance,
    onOpenHandover,
    onOpenInterrupt,
    onReportPlanning
}: any) => {

    const markers = useMemo(() => {
        // 1. Usamos allObjectives que YA VIENE FILTRADO desde el padre
        return allObjectives.filter((obj: any) => obj.lat && obj.lng).map((obj: any) => {
            
            // 2. Buscar turnos para este objetivo
            const shiftsInObjective = filteredShifts.filter((s: any) => s.objectiveId === obj.id);
            
            let icon = Icons.GRAY; // Default: Gris
            let statusText = 'S/A'; // Sin Actividad
            let priority = 0; 

            // 3. Determinar color por gravedad
            if (shiftsInObjective.length > 0) {
                shiftsInObjective.forEach((s: any) => {
                    const now = new Date();
                    const start = s.shiftDateObj ? (s.shiftDateObj.seconds ? new Date(s.shiftDateObj.seconds * 1000) : s.shiftDateObj) : new Date();
                    const diffMin = (now.getTime() - start.getTime()) / 60000;

                    if ((s.isUnassigned || (!s.isPresent && !s.isCompleted && diffMin > 60)) && priority < 5) {
                        icon = Icons.RED; statusText = s.isUnassigned ? 'VACANTE' : 'AUSENCIA'; priority = 5;
                    } else if (s.isRetention && priority < 4) {
                        icon = Icons.ORANGE; statusText = 'RETENCIÓN'; priority = 4;
                    } else if (!s.isPresent && !s.isCompleted && diffMin > 5 && diffMin <= 60 && priority < 3) {
                        icon = Icons.YELLOW; statusText = 'TARDE'; priority = 3;
                    } else if ((s.isPresent || (diffMin >= -15 && diffMin <= 5 && !s.isPresent)) && priority < 2) {
                        icon = Icons.GREEN; statusText = s.isPresent ? 'ACTIVO' : 'A TIEMPO'; priority = 2;
                    } else if (s.isFranco && priority < 1) {
                        icon = Icons.BLUE; statusText = 'FRANCO'; priority = 1;
                    }
                });
            }

            return {
                id: obj.id,
                lat: obj.lat,
                lng: obj.lng,
                name: obj.name,
                client: obj.clientName || 'Cliente',
                shifts: shiftsInObjective,
                icon,
                statusText,
                hasShift: shiftsInObjective.length > 0
            };
        });
    }, [allObjectives, filteredShifts]); 

    return (
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} className="z-0">
            <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" attribution='&copy; CARTO' />
            <MapUpdater markers={markers} />

            {markers.map((marker: any) => (
                <Marker key={marker.id} position={[marker.lat, marker.lng]} icon={marker.icon}>
                    <Popup className="custom-popup">
                        <div className="min-w-[240px]">
                            <div className="border-b pb-2 mb-2 flex justify-between items-start">
                                <div>
                                    <h3 className="font-black text-sm text-slate-800 leading-tight">{marker.name}</h3>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">{marker.client}</p>
                                </div>
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded text-white ${marker.statusText === 'AUSENCIA' || marker.statusText === 'VACANTE' ? 'bg-rose-600' : (marker.statusText === 'TARDE' ? 'bg-amber-500' : (marker.statusText === 'ACTIVO' ? 'bg-emerald-600' : 'bg-slate-400'))}`}>{marker.statusText}</span>
                            </div>

                            <div className="space-y-2 max-h-[250px] overflow-y-auto">
                                {marker.hasShift ? marker.shifts.map((shift: any) => {
                                    const now = new Date();
                                    const start = shift.shiftDateObj ? (shift.shiftDateObj.seconds ? new Date(shift.shiftDateObj.seconds * 1000) : shift.shiftDateObj) : new Date();
                                    const diffMin = (now.getTime() - start.getTime()) / 60000;
                                    const canCheckIn = diffMin >= -15 && diffMin <= 60 && !shift.isPresent; 

                                    return (
                                        <div key={shift.id} className="bg-slate-50 p-2 rounded border border-slate-100">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-[10px] font-bold text-slate-700 truncate max-w-[120px]">{shift.employeeName || 'VACANTE'}</span>
                                                <span className="text-[9px] font-mono text-slate-400">{start.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                            </div>
                                            <div className="flex gap-1">
                                                {shift.isUnassigned && !shift.isReportedToPlanning && (
                                                    <button onClick={() => onOpenCoverage(shift)} className="flex-1 bg-rose-600 text-white text-[9px] py-1 rounded font-bold hover:bg-rose-700">CUBRIR</button>
                                                )}
                                                {!shift.isPresent && !shift.isUnassigned && !shift.isCompleted && (
                                                    diffMin > 60 ? (
                                                        <button onClick={() => onOpenAttendance(shift)} className="flex-1 bg-rose-100 text-rose-700 border border-rose-200 text-[9px] py-1 rounded font-bold hover:bg-rose-200">AUSENCIA</button>
                                                    ) : (
                                                        <button onClick={() => onOpenHandover(shift)} disabled={!canCheckIn} className={`flex-1 text-white text-[9px] py-1 rounded font-bold ${canCheckIn ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-300'}`}>{diffMin > 5 ? 'LLEGÓ?' : 'PRESENTE'}</button>
                                                    )
                                                )}
                                                {(shift.isPresent || shift.status === 'PRESENT') && (
                                                    <button onClick={() => onOpenInterrupt(shift)} className="flex-1 bg-rose-50 text-rose-600 border border-rose-200 text-[9px] py-1 rounded font-bold hover:bg-rose-100">BAJA</button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="text-center p-2 text-[10px] text-slate-400 italic">No hay actividad.</div>
                                )}
                            </div>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
};

export default OperacionesMap;
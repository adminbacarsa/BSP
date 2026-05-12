import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { getAuth } from 'firebase/auth';
import { Bug, CheckCircle, XCircle, RefreshCw, Download } from 'lucide-react';

// --- FUNCIONES AUXILIARES ---

const safeDate = (dateInput: any): Date | null => {
    if (!dateInput) return null;
    try {
        if (dateInput.seconds) return new Date(dateInput.seconds * 1000);
        if (dateInput instanceof Date) return dateInput;
        const d = new Date(dateInput);
        return isNaN(d.getTime()) ? null : d;
    } catch (e) { return null; }
};

const formatTime = (dateInput: any) => {
    const d = safeDate(dateInput);
    if (!d) return '--:--';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (dateInput: any) => {
    const d = safeDate(dateInput);
    if (!d) return 'FECHA INVALIDA';
    return d.toLocaleString('es-AR');
};

export default function DebugPage() {
    const { processedData, recentLogs } = useOperacionesMonitor();
    
    const [user, setUser] = useState<any>(null);
    const [filterAnalysis, setFilterAnalysis] = useState<any[]>([]);

    useEffect(() => {
        const auth = getAuth();
        setUser(auth.currentUser);
    }, []);

    // --- ANÁLISIS DE FILTRADO ---
    useEffect(() => {
        if (!processedData) return;

        const now = new Date();
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);

        const analysis = processedData.map((s: any) => {
            const report: any = {
                id: s.id,
                employee: s.employeeName || 'Sin Nombre',
                objective: s.objectiveName || 'Sin Objetivo',
                rawType: s.shiftType,
                rawStatus: s.status,
                isPresent: s.isPresent,
                isRetention: s.isRetention,
                isCompleted: s.isCompleted,
                startTime: formatDateTime(s.shiftDateObj || s.startTime),
                endTime: formatDateTime(s.endDateObj || s.endTime),
                decision: 'ACEPTADO',
                reason: 'Cumple criterios base'
            };

            // 1. BASURA
            if (s.status === 'CANCELED' || s.status === 'DRAFT') {
                report.decision = 'ELIMINADO';
                report.reason = `Estado inválido: ${s.status}`;
                return report;
            }

            // 2. FRANCOS
            const typeUpper = (s.shiftType || '').toUpperCase();
            const statusUpper = (s.status || '').toUpperCase();
            const prohibited = ['FRANCO', 'OFF', 'LICENCIA', 'VACACIONES', 'ART', 'CARPETA'];
            
            if (prohibited.some(term => typeUpper.includes(term))) {
                report.decision = 'ELIMINADO';
                report.reason = `Es Franco (Tipo: ${s.shiftType})`;
                return report;
            }
            if (prohibited.some(term => statusUpper.includes(term))) {
                report.decision = 'ELIMINADO';
                report.reason = `Es Franco (Estado: ${s.status})`;
                return report;
            }

            // 3. FECHAS
            let start = safeDate(s.shiftDateObj) || safeDate(s.startTime);

            if (!start) {
                report.decision = 'ELIMINADO';
                report.reason = 'Fecha de inicio inválida/nula';
                return report;
            }

            const isToday = (start >= todayStart && start <= todayEnd);
            const isActive = s.isPresent && !s.isCompleted; 
            const isRetained = s.isRetention;

            if (isActive) {
                report.decision = 'ACEPTADO (ACTIVO)';
                report.reason = 'Guardia Presente. Se fuerza visualización.';
            } else if (isRetained) {
                report.decision = 'ACEPTADO (RETENIDO)';
                report.reason = 'Guardia Retenido. Se fuerza visualización.';
            } else if (isToday) {
                report.decision = 'ACEPTADO (HOY)';
                report.reason = 'Es un turno planificado para hoy.';
            } else {
                const hoursDiff = (now.getTime() - start.getTime()) / (1000 * 60 * 60);
                if ((s.isLate || s.isAbsent) && !s.isCompleted && hoursDiff < 30) {
                    report.decision = 'ACEPTADO (PENDIENTE)';
                    report.reason = 'Incidencia de ayer sin resolver.';
                } else {
                    report.decision = 'ELIMINADO';
                    report.reason = `Fecha pasada y NO está presente.`;
                }
            }

            return report;
        });

        setFilterAnalysis(analysis);

    }, [processedData]);

    // --- FUNCIÓN DE DESCARGA JSON ---
    const handleDownloadDump = () => {
        const dumpData = {
            timestamp: new Date().toISOString(),
            currentUser: {
                uid: user?.uid || 'NO_AUTH',
                email: user?.email || 'NO_EMAIL'
            },
            logsReceived: recentLogs, // Para ver si coinciden los UIDs
            analysis: filterAnalysis, // Para ver por qué se eliminan turnos
            rawDataSample: processedData.slice(0, 10) // Para ver la estructura cruda
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dumpData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `debug_operaciones_${new Date().getTime()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        
        alert("Archivo de diagnóstico descargado. Por favor envíalo al soporte.");
    };

    return (
        <DashboardLayout>
            <div className="p-6 space-y-8 bg-slate-50 min-h-screen text-slate-800">
                
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <h1 className="text-2xl font-black flex items-center gap-2">
                        <Bug className="text-red-600"/> DIAGNÓSTICO DE DATOS
                    </h1>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleDownloadDump} 
                            className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex gap-2 font-bold shadow-lg"
                        >
                            <Download size={18}/> DESCARGAR REPORTE JSON
                        </button>
                        <button 
                            onClick={() => window.location.reload()} 
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex gap-2 font-bold shadow-lg"
                        >
                            <RefreshCw size={18}/> Recargar
                        </button>
                    </div>
                </div>

                {/* 1. USUARIO */}
                <div className="bg-white p-6 rounded-xl border border-slate-300 shadow-sm">
                    <h2 className="text-lg font-bold mb-4 text-slate-700 underline">1. Diagnóstico de Bitácora</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                        <div className="p-3 bg-slate-100 rounded border">
                            <p className="font-bold text-slate-500">TU USUARIO ACTUAL:</p>
                            <p className="font-mono text-blue-600 font-bold break-all">{user ? user.uid : 'DESCONECTADO'}</p>
                            <p className="text-xs text-slate-400">{user?.email}</p>
                        </div>
                        <div className="p-3 bg-slate-100 rounded border">
                            <p className="font-bold text-slate-500">TOTAL LOGS RECIBIDOS:</p>
                            <p className="font-mono text-purple-600 font-bold text-lg">{recentLogs?.length || 0}</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto bg-slate-900 rounded-lg p-2 text-xs font-mono text-slate-300">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-yellow-500 border-b border-slate-700">
                                    <th className="p-2">HORA</th>
                                    <th className="p-2">ACCIÓN</th>
                                    <th className="p-2">ACTOR UID</th>
                                    <th className="p-2">COINCIDE?</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentLogs && recentLogs.slice(0, 10).map((l:any, i) => {
                                    const isMatch = l.actorUid === user?.uid;
                                    return (
                                        <tr key={i} className="border-b border-slate-800">
                                            <td className="p-2">{formatTime(l.timestamp)}</td>
                                            <td className="p-2 text-white">{l.action || l.type}</td>
                                            <td className="p-2">{l.actorUid}</td>
                                            <td className="p-2">
                                                {isMatch 
                                                    ? <span className="text-green-400 font-bold">SÍ (Visible)</span> 
                                                    : <span className="text-red-400">NO (Oculto)</span>
                                                }
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 2. TABLA */}
                <div className="bg-white p-6 rounded-xl border border-slate-300 shadow-sm">
                    <h2 className="text-lg font-bold mb-4 text-slate-700 underline">2. Análisis de Turnos (Mapa y Lista)</h2>
                    <p className="text-sm text-slate-500 mb-4">Total turnos procesados: <b>{processedData?.length || 0}</b></p>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left border-collapse border border-slate-200">
                            <thead className="bg-slate-800 text-white">
                                <tr>
                                    <th className="p-2 border border-slate-600">EMPLEADO / OBJETIVO</th>
                                    <th className="p-2 border border-slate-600">TIPO / ESTADO</th>
                                    <th className="p-2 border border-slate-600">HORARIO</th>
                                    <th className="p-2 border border-slate-600">FLAGS</th>
                                    <th className="p-2 border border-slate-600">DECISIÓN</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filterAnalysis.map((row: any) => (
                                    <tr key={row.id} className={`border-b ${row.decision.includes('ACEPTADO') ? 'bg-emerald-50' : 'bg-red-50'}`}>
                                        <td className="p-2 border font-bold text-slate-700">
                                            {row.employee}<br/>
                                            <span className="text-[10px] text-slate-500 font-normal">{row.objective}</span>
                                        </td>
                                        <td className="p-2 border">
                                            {row.rawType}<br/>
                                            <span className="text-[10px] text-slate-500">{row.rawStatus}</span>
                                        </td>
                                        <td className="p-2 border">
                                            <span className="text-green-700">In: {row.startTime}</span><br/>
                                            <span className="text-red-700">Out: {row.endTime}</span>
                                        </td>
                                        <td className="p-2 border text-center">
                                            {row.isPresent && <span className="bg-green-200 text-green-800 px-1 rounded mx-1">PRESENTE</span>}
                                            {row.isRetention && <span className="bg-orange-200 text-orange-800 px-1 rounded mx-1">RETENIDO</span>}
                                        </td>
                                        <td className="p-2 border">
                                            {row.decision.includes('ACEPTADO') 
                                                ? <span className="text-green-700 font-bold flex items-center gap-1"><CheckCircle size={14}/> {row.decision}</span>
                                                : <span className="text-red-700 font-bold flex items-center gap-1"><XCircle size={14}/> {row.decision}</span>
                                            }
                                            <div className="text-[9px] text-slate-500 italic">{row.reason}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </DashboardLayout>
    );
}
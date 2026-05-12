
import React, { useEffect, useState } from 'react';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Database, Server, Download, Activity, AlertCircle } from 'lucide-react';

const COLLECTIONS = ["audit_logs","auditorias","audits","ausencias","clients","config","convenios_colectivos","empleados","feriados","historial_operaciones","historial_resoluciones","novedades","planificaciones_historial","roles","servicios_sla","system_users","tipos_turno","turnos"];
const FUNCTIONS = [{"name":"manageSystemUsers","url":"https://us-central1-comtroldata.cloudfunctions.net/manageSystemUsers"},{"name":"crearUsuarioSistema","url":"https://us-central1-comtroldata.cloudfunctions.net/crearUsuarioSistema"},{"name":"registrarFichadaManual","url":"https://us-central1-comtroldata.cloudfunctions.net/registrarFichadaManual"},{"name":"checkSystemHealth","url":"https://us-central1-comtroldata.cloudfunctions.net/checkSystemHealth"},{"name":"manageData","url":"https://us-central1-comtroldata.cloudfunctions.net/manageData"},{"name":"manageAgreements","url":"https://us-central1-comtroldata.cloudfunctions.net/manageAgreements"},{"name":"manageHierarchy","url":"https://us-central1-comtroldata.cloudfunctions.net/manageHierarchy"},{"name":"managePatterns","url":"https://us-central1-comtroldata.cloudfunctions.net/managePatterns"},{"name":"manageShifts","url":"https://us-central1-comtroldata.cloudfunctions.net/manageShifts"},{"name":"auditShift","url":"https://us-central1-comtroldata.cloudfunctions.net/auditShift"},{"name":"manageEmployees","url":"https://us-central1-comtroldata.cloudfunctions.net/manageEmployees"},{"name":"manageAbsences","url":"https://us-central1-comtroldata.cloudfunctions.net/manageAbsences"},{"name":"createUser","url":"https://us-central1-comtroldata.cloudfunctions.net/createUser"},{"name":"limpiarBaseDeDatos","url":"https://us-central1-comtroldata.cloudfunctions.net/limpiarBaseDeDatos"},{"name":"manageAudits","url":"https://us-central1-comtroldata.cloudfunctions.net/manageAudits"},{"name":"scheduleShift","url":"https://us-central1-comtroldata.cloudfunctions.net/scheduleShift"},{"name":"reportarAusencia","url":"https://us-central1-comtroldata.cloudfunctions.net/reportarAusencia"}];

export const AutoSchemaDoc = () => {
    const [dbReport, setDbReport] = useState<any>({});
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => { scanDatabase(); }, []);

    const scanDatabase = async () => {
        setLoading(true);
        const report: any = {};
        let processed = 0;

        for (const col of COLLECTIONS) {
            try {
                // Muestreo: 5 documentos
                const q = query(collection(db, col), limit(5));
                const snap = await getDocs(q);
                
                if (snap.empty) {
                    report[col] = { status: 'EMPTY', count: 0, fields: {} };
                } else {
                    const fields: any = {};
                    snap.docs.forEach(doc => {
                        const data = doc.data();
                        Object.keys(data).forEach(key => {
                            const val = data[key];
                            let type = typeof val;
                            if (val?.seconds) type = 'Timestamp';
                            else if (Array.isArray(val)) type = 'Array';
                            else if (val === null) type = 'Null';
                            else if (typeof val === 'object') type = 'Object';
                            
                            // Guardamos tipo y una muestra corta
                            if (!fields[key]) {
                                fields[key] = { 
                                    type, 
                                    sample: JSON.stringify(val).slice(0, 40) 
                                };
                            }
                        });
                    });
                    report[col] = { status: 'ACTIVE', count: snap.size + '+', fields };
                }
            } catch (e: any) {
                report[col] = { status: 'ERROR', error: e.message };
            }
            
            processed++;
            setProgress(Math.round((processed / COLLECTIONS.length) * 100));
        }
        setDbReport(report);
        setLoading(false);
    };

    const downloadFullReport = () => {
        const payload = {
            timestamp: new Date().toISOString(),
            project: 'CronoApp',
            architecture: {
                database: dbReport,
                backend_functions: FUNCTIONS
            }
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
        const anchor = document.createElement('a');
        anchor.setAttribute("href", dataStr);
        anchor.setAttribute("download", "CRONOAPP_ARQUITECTURA_COMPLETA.json");
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    };

    return (
        <div className="p-6 bg-slate-100 min-h-screen font-sans text-slate-800">
            {/* HEADER */}
            <header className="bg-white p-6 rounded-xl shadow-sm mb-6 flex justify-between items-center border-l-4 border-indigo-600">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Activity className="text-indigo-600" /> Mapa de Arquitectura Vivo
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Base de Datos ({COLLECTIONS.length} colecciones) + Backend ({FUNCTIONS.length} funciones)
                    </p>
                </div>
                <button 
                    onClick={downloadFullReport}
                    disabled={loading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-bold shadow transition-all flex items-center gap-2 disabled:opacity-50"
                >
                    <Download size={20}/> DESCARGAR MAPA COMPLETO
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* COLUMNA 1 & 2: BASE DE DATOS */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl shadow-sm p-4 border border-slate-200">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-4 border-b pb-2">
                            <Database className="text-indigo-500" size={20}/> Estructura Firestore
                            {loading && <span className="text-xs text-indigo-500 animate-pulse ml-2">Escaneando {progress}%...</span>}
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.keys(dbReport).sort().map(col => {
                                const info = dbReport[col];
                                const isEmpty = info.status === 'EMPTY';
                                const isError = info.status === 'ERROR';

                                return (
                                    <div key={col} className={`border rounded-lg p-3 transition-colors ${isEmpty ? 'bg-slate-50 opacity-70' : 'bg-white hover:border-indigo-300'}`}>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-mono font-bold text-slate-700">{col}</span>
                                            {isEmpty && <span className="text-[10px] bg-slate-200 px-2 rounded">VACÍA</span>}
                                            {isError && <AlertCircle size={14} className="text-red-500"/>}
                                            {!isEmpty && !isError && <span className="text-[10px] bg-green-100 text-green-800 px-2 rounded font-bold">ACTIVA</span>}
                                        </div>
                                        
                                        {!isEmpty && !isError && (
                                            <div className="space-y-1">
                                                {Object.keys(info.fields).slice(0, 5).map(f => (
                                                    <div key={f} className="flex justify-between text-xs text-slate-500">
                                                        <span>{f}</span>
                                                        <span className="bg-slate-100 px-1 rounded text-[10px]">{info.fields[f].type}</span>
                                                    </div>
                                                ))}
                                                {Object.keys(info.fields).length > 5 && (
                                                    <div className="text-[10px] text-center text-slate-400 mt-1 italic">
                                                        + {Object.keys(info.fields).length - 5} campos más
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {isError && <p className="text-xs text-red-500">{info.error}</p>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* COLUMNA 3: CLOUD FUNCTIONS */}
                <div>
                    <div className="bg-slate-900 rounded-xl shadow-lg p-4 text-slate-300 h-full overflow-y-auto max-h-[calc(100vh-150px)]">
                        <h2 className="font-bold text-white flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
                            <Server className="text-green-400" size={20}/> Cloud Functions
                        </h2>
                        <div className="space-y-3">
                            {FUNCTIONS.map((fn, idx) => (
                                <div key={idx} className="group">
                                    <div className="font-mono text-sm text-green-400 font-bold group-hover:text-green-300 transition-colors">
                                        {fn.name}
                                    </div>
                                    <div className="text-[10px] text-slate-500 break-all hover:text-slate-400 cursor-pointer">
                                        {fn.url}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 pt-4 border-t border-slate-700 text-xs text-center text-slate-500">
                            Total: {FUNCTIONS.length} Endpoints Activos
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
export default AutoSchemaDoc;

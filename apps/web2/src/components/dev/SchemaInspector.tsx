
import React, { useEffect, useState } from 'react';
import { collection, getDocs, limit, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase'; // Ajusta esto si tu import es diferente

// --- CONFIGURACIÓN DE EXPECTATIVAS (LO QUE NECESITAMOS PARA V7.0) ---
const REQUIRED_SCHEMA: any = {
    turnos: {
        fields: ['isRetention', 'isLate', 'isAbsentUnwarned', 'medicalIncident', 'resolutionStatus', 'employeeId', 'status'],
        types: { isRetention: 'boolean', isLate: 'boolean', resolutionStatus: 'string' }
    },
    empleados: {
        fields: ['legajo', 'dni', 'isAvailable'],
        types: { isAvailable: 'boolean' }
    },
    clients: {
        fields: ['objetivos'], // Detectar si es array o subcolección
        types: {}
    }
};

export const SchemaInspector = () => {
    const [schema, setSchema] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        inspectDB();
    }, []);

    const inspectDB = async () => {
        try {
            const results: any = {};
            const collections = ['turnos', 'empleados', 'clients', 'audit_logs', 'novedades'];

            for (const colName of collections) {
                // Traer muestra de 5 docs recientes
                const q = query(collection(db, colName), limit(5));
                const snap = await getDocs(q);
                
                if (snap.empty) {
                    results[colName] = { status: 'EMPTY', fields: {} };
                    continue;
                }

                // Analizar campos (Merge de las claves de los 5 docs para ver todo lo posible)
                const fieldMap: any = {};
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    Object.keys(data).forEach(key => {
                        const val = data[key];
                        let type = typeof val;
                        if (val && typeof val === 'object') {
                            if (val.seconds !== undefined && val.nanoseconds !== undefined) type = 'Timestamp';
                            else if (Array.isArray(val)) type = 'Array';
                            else type = 'Map';
                        }
                        // Guardar tipo y ejemplo
                        if (!fieldMap[key]) fieldMap[key] = { type, example: JSON.stringify(val).slice(0, 30) };
                    });
                });
                results[colName] = { status: 'OK', count: snap.size, fields: fieldMap };
            }
            setSchema(results);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-10 text-blue-500 font-bold text-xl animate-pulse">📡 ESCANEANDO FIRESTORE...</div>;
    if (error) return <div className="p-10 text-red-500 font-bold">❌ ERROR DE CONEXIÓN: {error}</div>;

    return (
        <div className="p-8 bg-slate-50 min-h-screen font-sans text-slate-800">
            <header className="mb-8 border-b border-blue-500 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">🔍 INSPECTOR DE ESQUEMA (LIVE)</h1>
                    <p className="text-slate-500">Muestreo en tiempo real de tu base de datos Firebase</p>
                </div>
                <button onClick={inspectDB} className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700">🔄 Re-Escanear</button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {Object.keys(schema).map(col => {
                    const data = schema[col];
                    const req = REQUIRED_SCHEMA[col] || { fields: [] };
                    
                    return (
                        <div key={col} className="bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
                            <div className="bg-slate-800 text-white px-4 py-3 flex justify-between items-center">
                                <h3 className="font-mono text-xl text-blue-300">{col}</h3>
                                <span className="text-xs bg-slate-700 px-2 py-1 rounded">
                                    {data.status === 'EMPTY' ? 'VACÍA' : `Muestra: ${data.count} docs`}
                                </span>
                            </div>
                            
                            <div className="p-0 overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-100 text-slate-500 uppercase font-bold text-xs">
                                        <tr>
                                            <th className="px-4 py-2">Campo Real</th>
                                            <th className="px-4 py-2">Tipo Detectado</th>
                                            <th className="px-4 py-2">Estado V7</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {Object.keys(data.fields).sort().map(field => {
                                            const info = data.fields[field];
                                            const isRequired = req.fields.includes(field);
                                            return (
                                                <tr key={field} className="hover:bg-slate-50">
                                                    <td className="px-4 py-2 font-mono font-medium text-slate-700">{field}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                                            info.type === 'boolean' ? 'bg-orange-100 text-orange-700' :
                                                            info.type === 'Timestamp' ? 'bg-purple-100 text-purple-700' :
                                                            'bg-slate-100 text-slate-600'
                                                        }`}>
                                                            {info.type}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        {isRequired 
                                                            ? <span className="text-green-600 font-bold text-xs">✅ COMPATIBLE</span>
                                                            : <span className="text-slate-400 text-xs">-</span>
                                                        }
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {/* MOSTRAR CAMPOS FALTANTES CRÍTICOS */}
                                        {req.fields.filter((f:string) => !data.fields[f]).map((missing:string) => (
                                            <tr key={'missing-'+missing} className="bg-red-50 border-l-4 border-red-500">
                                                <td className="px-4 py-2 font-mono text-red-600 font-bold">{missing}</td>
                                                <td className="px-4 py-2 text-red-400 italic">No encontrado</td>
                                                <td className="px-4 py-2"><span className="bg-red-600 text-white text-xs px-2 py-1 rounded">⚠️ CRÍTICO V7</span></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

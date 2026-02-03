
import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Bell, AlertTriangle, CheckCircle, ArrowRight, Clock } from 'lucide-react';
import { toast } from 'sonner';

export const PlanningAlerts = () => {
    const [alerts, setAlerts] = useState<any[]>([]);
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        // Escuchar novedades pendientes de alta prioridad (Operaciones)
        const q = query(
            collection(db, 'novedades'), 
            where('status', '==', 'pending'),
            where('priority', '==', 'high'), // Solo urgencias
            orderBy('createdAt', 'desc')
        );

        const unsub = onSnapshot(q, (snap) => {
            setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => unsub();
    }, []);

    const handleDismiss = async (alertId: string) => {
        try {
            await updateDoc(doc(db, 'novedades', alertId), {
                status: 'acknowledged',
                read: true,
                readAt: serverTimestamp()
            });
            toast.success("Alerta archivada");
        } catch (e) { console.error(e); }
    };

    if (alerts.length === 0) return null;

    return (
        <div className="mb-6 animate-in slide-in-from-top-2">
            <div className="bg-rose-50 border border-rose-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-rose-100/50 p-3 flex justify-between items-center cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
                    <div className="flex items-center gap-2 text-rose-700 font-bold">
                        <div className="relative">
                            <Bell size={20} className="animate-pulse"/>
                            <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-white">
                                {alerts.length}
                            </span>
                        </div>
                        <h3>URGENCIAS DE OPERACIONES</h3>
                    </div>
                    <span className="text-xs text-rose-500 font-medium">Click para contraer</span>
                </div>
                
                {isOpen && (
                    <div className="divide-y divide-rose-100 max-h-60 overflow-y-auto">
                        {alerts.map((alert) => (
                            <div key={alert.id} className="p-3 hover:bg-white transition-colors flex gap-3 items-start">
                                <div className="mt-1 bg-white p-1.5 rounded-lg border border-rose-100 text-rose-500">
                                    <AlertTriangle size={16}/>
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-sm font-black text-slate-800 uppercase">{alert.title}</h4>
                                    <p className="text-xs text-slate-600 mt-0.5">{alert.description}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded flex items-center gap-1">
                                            <Clock size={10}/> 
                                            {alert.createdAt?.seconds ? new Date(alert.createdAt.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Ahora'}
                                        </span>
                                        <span className="text-[10px] font-bold text-rose-400">Por: {alert.reportedBy || 'OPERACIONES'}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <button onClick={() => handleDismiss(alert.id)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded hover:bg-slate-50 flex items-center gap-1">
                                        <CheckCircle size={12}/> Visto
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

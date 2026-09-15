import React from 'react';
import { Layers, Loader2, Save, X } from 'lucide-react';

type Props = {
    mode: 'new' | 'edit';
    name: string;
    clientId: string;
    objectiveIds: string[];
    clients: any[];
    saving: boolean;
    onClose: () => void;
    onNameChange: (value: string) => void;
    onClientChange: (value: string) => void;
    onToggleObjective: (objectiveId: string) => void;
    onSave: () => void;
};

export default function PlanningGroupFormModal({
    mode,
    name,
    clientId,
    objectiveIds,
    clients,
    saving,
    onClose,
    onNameChange,
    onClientChange,
    onToggleObjective,
    onSave,
}: Props) {
    const selectedClientObjectives = clientId
        ? [...(clients.find((client: any) => client.id === clientId)?.objetivos || [])]
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        : [];
    const canSave = !saving && name.trim().length > 0 && clientId.length > 0 && objectiveIds.length >= 2;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
                    <h3 className="font-black text-base flex items-center gap-2 text-violet-700">
                        <Layers size={16}/>{mode === 'new' ? 'Nuevo grupo de objetivos' : 'Editar grupo'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={18}/>
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Nombre del grupo</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(event) => onNameChange(event.target.value)}
                            placeholder="Ej: Banco Nación — Sucursales Norte"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Cliente</label>
                        <select
                            value={clientId}
                            onChange={(event) => onClientChange(event.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                            <option value="">— Selecionar cliente —</option>
                            {[...clients].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((client: any) => (
                                <option key={client.id} value={client.id}>{client.name}</option>
                            ))}
                        </select>
                    </div>

                    {clientId && (
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-2">
                                Objetivos del grupo <span className="text-slate-400 font-normal">(mínimo 2)</span>
                            </label>
                            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                {selectedClientObjectives.map((objective: any) => {
                                    const objectiveId = objective.id || objective.name;
                                    const checked = objectiveIds.includes(objectiveId);
                                    return (
                                        <label key={objectiveId} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-violet-50 border border-violet-200' : 'bg-slate-50 border border-transparent hover:bg-slate-100'}`}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => onToggleObjective(objectiveId)}
                                                className="accent-violet-600"
                                            />
                                            <span className="text-sm font-medium text-slate-700">{objective.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            {objectiveIds.length > 0 && (
                                <p className="mt-1.5 text-[11px] text-violet-600 font-semibold">
                                    {objectiveIds.length} objetivo{objectiveIds.length !== 1 ? 's' : ''} seleccionado{objectiveIds.length !== 1 ? 's' : ''}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t bg-slate-50 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors">
                        Cancelar
                    </button>
                    <button
                        onClick={onSave}
                        disabled={!canSave}
                        className="px-5 py-2 rounded-lg text-sm font-black bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
                        {mode === 'new' ? 'Crear grupo' : 'Guardar cambios'}
                    </button>
                </div>
            </div>
        </div>
    );
}

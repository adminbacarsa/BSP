import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { gruposService, type GrupoObjetivos } from '@/services/gruposService';

export type SavePlanificacionGrupoParams = {
    grupoFormNombre: string;
    grupoFormClientId: string;
    grupoFormObjectiveIds: string[];
    grupoFormMode: 'new' | 'edit';
    grupoFormEditId: string | null;
    empresaId: string | undefined | null;
    clients: any[];
    selectedGrupo: GrupoObjetivos | null;
    setSavingGrupo: (value: boolean) => void;
    setGrupos: Dispatch<SetStateAction<GrupoObjetivos[]>>;
    setSelectedGrupo: Dispatch<SetStateAction<GrupoObjetivos | null>>;
    setShowGrupoForm: (value: boolean) => void;
};

export async function savePlanificacionGrupo({
    grupoFormNombre,
    grupoFormClientId,
    grupoFormObjectiveIds,
    grupoFormMode,
    grupoFormEditId,
    empresaId,
    clients,
    selectedGrupo,
    setSavingGrupo,
    setGrupos,
    setSelectedGrupo,
    setShowGrupoForm,
}: SavePlanificacionGrupoParams): Promise<void> {
    if (!grupoFormNombre.trim() || !grupoFormClientId || grupoFormObjectiveIds.length < 2) {
        toast.error('El grupo necesita un nombre y al menos 2 objetivos.');
        return;
    }
    setSavingGrupo(true);
    try {
        const client = clients.find((c: any) => c.id === grupoFormClientId);
        const clientObjetivos: any[] = client?.objetivos || [];
        const objectiveNames = grupoFormObjectiveIds.map(oid => {
            const obj = clientObjetivos.find((o: any) => (o.id || o.name) === oid);
            return obj?.name || oid;
        });
        const payload = {
            empresaId,
            nombre: grupoFormNombre.trim(),
            clientId: grupoFormClientId,
            clientName: client?.name || '',
            objectiveIds: grupoFormObjectiveIds,
            objectiveNames,
        };
        if (grupoFormMode === 'edit' && grupoFormEditId) {
            await gruposService.update(grupoFormEditId, payload);
            setGrupos(prev => prev.map(g => g.id === grupoFormEditId ? { ...g, ...payload } : g));
            if (selectedGrupo?.id === grupoFormEditId) setSelectedGrupo({ ...selectedGrupo, ...payload });
            toast.success('Grupo actualizado.');
        } else {
            const newId = await gruposService.add(payload);
            setGrupos(prev => [...prev, { id: newId, ...payload }]);
            toast.success('Grupo creado.');
        }
        setShowGrupoForm(false);
    } catch (e) {
        console.error(e);
        toast.error('Error al guardar el grupo.');
    } finally {
        setSavingGrupo(false);
    }
}

export type DeletePlanificacionGrupoParams = {
    grupo: GrupoObjetivos;
    selectedGrupo: GrupoObjetivos | null;
    setGrupos: Dispatch<SetStateAction<GrupoObjetivos[]>>;
    handleGrupoChange: (grupo: GrupoObjetivos | null) => void;
};

export async function deletePlanificacionGrupo({
    grupo,
    selectedGrupo,
    setGrupos,
    handleGrupoChange,
}: DeletePlanificacionGrupoParams): Promise<void> {
    if (!confirm(`¿Eliminar el grupo "${grupo.nombre}"?`)) return;
    try {
        await gruposService.delete(grupo.id!);
        setGrupos(prev => prev.filter(g => g.id !== grupo.id));
        if (selectedGrupo?.id === grupo.id) handleGrupoChange(null);
        toast.success('Grupo eliminado.');
    } catch {
        toast.error('Error al eliminar el grupo.');
    }
}

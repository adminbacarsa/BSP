import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { SupervisorObjective } from '@/hooks/useSupervisorScope';

type ClientGroup = {
  id: string;
  name: string;
  objectives: SupervisorObjective[];
};

export type SupervisionClienteObjetivoPickerProps = {
  objectives: SupervisorObjective[];
  clientId: string;
  objectiveId: string;
  onClientChange: (clientId: string) => void;
  onObjectiveChange: (objectiveId: string) => void;
  allowAll?: boolean;
  compact?: boolean;
  className?: string;
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function groupByClient(objectives: SupervisorObjective[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  objectives.forEach(obj => {
    const current = map.get(obj.clientId);
    if (current) {
      current.objectives.push(obj);
      return;
    }
    map.set(obj.clientId, {
      id: obj.clientId,
      name: obj.clientName,
      objectives: [obj],
    });
  });
  return Array.from(map.values())
    .map(group => ({
      ...group,
      objectives: group.objectives.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export default function SupervisionClienteObjetivoPicker({
  objectives,
  clientId,
  objectiveId,
  onClientChange,
  onObjectiveChange,
  allowAll = false,
  compact = false,
  className = '',
}: SupervisionClienteObjetivoPickerProps) {
  const clients = useMemo(() => groupByClient(objectives), [objectives]);
  const selectedClient = clients.find(client => client.id === clientId);
  const selectedObjective = objectives.find(obj => obj.id === objectiveId);

  const [clientQuery, setClientQuery] = useState('');
  const [objectiveQuery, setObjectiveQuery] = useState('');
  const [clientFocused, setClientFocused] = useState(false);
  const [objectiveFocused, setObjectiveFocused] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setClientQuery('');
      return;
    }
    setClientQuery(selectedClient?.name || '');
  }, [clientId, selectedClient?.name]);

  useEffect(() => {
    if (!objectiveId) {
      setObjectiveQuery('');
      return;
    }
    setObjectiveQuery(selectedObjective?.name || '');
  }, [objectiveId, selectedObjective?.name]);

  const filteredClients = useMemo(() => {
    const query = normalize(clientQuery);
    if (!query) return clients;
    return clients.filter(client => client.name.toLowerCase().includes(query));
  }, [clients, clientQuery]);

  const objectiveOptions = useMemo(() => {
    const base = clientId
      ? (selectedClient?.objectives || [])
      : objectives;
    const query = normalize(objectiveQuery);
    if (!query) return base;
    return base.filter(obj => obj.name.toLowerCase().includes(query));
  }, [clientId, selectedClient, objectives, objectiveQuery]);

  const handleClientSelect = (nextClientId: string, label = '') => {
    onClientChange(nextClientId);
    onObjectiveChange('');
    setClientQuery(label);
    setObjectiveQuery('');
    setClientFocused(false);
  };

  const handleObjectiveSelect = (nextObjectiveId: string, label = '') => {
    onObjectiveChange(nextObjectiveId);
    setObjectiveQuery(label);
    setObjectiveFocused(false);
  };

  const showClientList = clientFocused && (clientQuery.trim() || !clientId || allowAll);
  const showObjectiveList = objectiveFocused && (allowAll || clientId) && (objectiveQuery.trim() || !objectiveId || allowAll);

  const inputCls = compact
    ? 'w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold'
    : 'w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold';

  const listCls = compact
    ? 'max-h-36 overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:bg-slate-800 shadow-sm'
    : 'max-h-44 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm';

  const itemCls = (active: boolean) => `w-full text-left px-3 py-2.5 transition-colors ${
    active
      ? 'bg-indigo-50 text-indigo-700 font-black'
      : 'hover:bg-slate-50 text-slate-700 font-bold'
  }`;

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Cliente</label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={clientQuery}
            onFocus={() => setClientFocused(true)}
            onBlur={() => window.setTimeout(() => setClientFocused(false), 150)}
            onChange={e => {
              setClientQuery(e.target.value);
              setClientFocused(true);
              if (clientId) onClientChange('');
              if (objectiveId) onObjectiveChange('');
            }}
            placeholder={allowAll ? 'Buscar cliente…' : 'Buscar y elegir cliente…'}
            className={inputCls}
          />
        </div>
        {showClientList && (
          <div className={`${listCls} mt-2`}>
            {allowAll && (
              <button
                type="button"
                onClick={() => handleClientSelect('')}
                className={itemCls(!clientId)}
              >
                Todos los clientes
              </button>
            )}
            {filteredClients.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-slate-400">Sin clientes para esa búsqueda</p>
            ) : filteredClients.map(client => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleClientSelect(client.id, client.name)}
                className={itemCls(clientId === client.id)}
              >
                <span className="block text-sm">{client.name}</span>
                <span className="block text-[10px] text-slate-400 font-medium">
                  {client.objectives.length} objetivo{client.objectives.length !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Objetivo</label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={objectiveQuery}
            onFocus={() => setObjectiveFocused(true)}
            onBlur={() => window.setTimeout(() => setObjectiveFocused(false), 150)}
            onChange={e => {
              setObjectiveQuery(e.target.value);
              setObjectiveFocused(true);
              if (objectiveId) onObjectiveChange('');
            }}
            disabled={!allowAll && !clientId}
            placeholder={
              !allowAll && !clientId
                ? 'Elegí un cliente primero'
                : allowAll && !clientId
                  ? 'Buscar objetivo en todos los clientes…'
                  : 'Buscar y elegir objetivo…'
            }
            className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
          />
        </div>
        {showObjectiveList && (
          <div className={`${listCls} mt-2`}>
            {allowAll && (
              <button
                type="button"
                onClick={() => handleObjectiveSelect('')}
                className={itemCls(!objectiveId)}
              >
                Todos los objetivos
              </button>
            )}
            {objectiveOptions.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-slate-400">Sin objetivos para esa búsqueda</p>
            ) : objectiveOptions.map(obj => (
              <button
                key={obj.id}
                type="button"
                onClick={() => handleObjectiveSelect(obj.id, obj.name)}
                className={itemCls(objectiveId === obj.id)}
              >
                <span className="block text-sm">{obj.name}</span>
                {!clientId && (
                  <span className="block text-[10px] text-slate-400 font-medium">{obj.clientName}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

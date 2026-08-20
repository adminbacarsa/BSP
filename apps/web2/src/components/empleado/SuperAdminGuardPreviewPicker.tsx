import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { Eye, QrCode, Search, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { MobilePreviewQrPanel } from '@/components/empleado/MobilePreviewQrPanel';

export type PreviewEmployeeRow = {
  id: string;
  name: string;
  empresa?: string;
  fileNumber?: string;
};

type Props = {
  variant?: 'inline' | 'overlay';
  selectedEmpId?: string | null;
  onSelect: (empId: string) => void;
  onClose?: () => void;
  title?: string;
};

export function SuperAdminGuardPreviewPicker({
  variant = 'inline',
  selectedEmpId = null,
  onSelect,
  onClose,
  title = 'Elegí un guardia para probar',
}: Props) {
  const [employees, setEmployees] = useState<PreviewEmployeeRow[]>([]);
  const [search, setSearch] = useState('');
  const [empresaFilter, setEmpresaFilter] = useState<string | null>(null);
  const [qrEmpId, setQrEmpId] = useState<string | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'empleados'), orderBy('lastName'), limit(500)))
      .then((snap) => {
        setEmployees(
          snap.docs.map((d) => {
            const data = d.data();
            const name = `${data.lastName || ''}, ${data.firstName || data.nombre || ''}`
              .trim()
              .replace(/^,\s*/, '');
            return {
              id: d.id,
              name: name || d.id,
              empresa: data.empresaId || '',
              fileNumber: data.fileNumber || data.legajo || '',
            };
          }),
        );
      })
      .catch(() => {});
  }, []);

  const empresas = useMemo(
    () => Array.from(new Set(employees.map((e) => e.empresa).filter(Boolean))).sort() as string[],
    [employees],
  );

  const filtered = useMemo(
    () =>
      employees.filter((e) => {
        const matchEmpresa = !empresaFilter || e.empresa === empresaFilter;
        const matchSearch =
          !search ||
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          (e.fileNumber && e.fileNumber.toLowerCase().includes(search.toLowerCase()));
        return matchEmpresa && matchSearch;
      }),
    [employees, empresaFilter, search],
  );

  const qrEmp = qrEmpId ? employees.find((e) => e.id === qrEmpId) : null;

  const shellClass =
    variant === 'overlay'
      ? 'fixed inset-0 z-[9999] bg-slate-950 flex flex-col'
      : 'rounded-2xl border border-orange-200 dark:border-orange-800/60 bg-slate-950 text-white flex flex-col overflow-hidden shadow-lg';

  return (
    <div className={shellClass}>
      <div
        className={`flex items-center gap-3 px-4 pt-4 pb-3 border-b border-slate-800 ${variant === 'inline' ? 'bg-orange-950/30' : ''}`}
      >
        <Eye className="w-5 h-5 text-orange-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-black text-sm">{title}</h2>
          <p className="text-slate-500 text-[11px]">
            {filtered.length} guardia{filtered.length !== 1 ? 's' : ''}
            {empresaFilter ? ` · ${empresaFilter}` : empresas.length ? ` · ${empresas.length} empresa${empresas.length !== 1 ? 's' : ''}` : ''}
            {' · '}Producción · sin notebook
          </p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        ) : null}
      </div>

      {empresas.length > 1 ? (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto border-b border-slate-800/60 scrollbar-none">
          <button
            type="button"
            onClick={() => setEmpresaFilter(null)}
            className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${!empresaFilter ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
          >
            Todas
          </button>
          {empresas.map((emp) => (
            <button
              key={emp}
              type="button"
              onClick={() => setEmpresaFilter(empresaFilter === emp ? null : emp)}
              className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${empresaFilter === emp ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
            >
              {emp}
            </button>
          ))}
        </div>
      ) : null}

      <div className="px-4 py-2.5 border-b border-slate-800/60">
        <div className="bg-slate-800 rounded-xl px-3 py-2 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Buscar por nombre o legajo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-white text-sm flex-1 outline-none placeholder-slate-500"
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')} className="text-slate-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={`overflow-y-auto px-4 py-2 space-y-1 ${variant === 'overlay' ? 'flex-1' : 'max-h-[420px]'}`}>
        {filtered.slice(0, 80).map((emp) => (
          <div key={emp.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setQrEmpId(null);
                onSelect(emp.id);
              }}
              className={`flex-1 text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors ${selectedEmpId === emp.id ? 'bg-orange-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800'}`}
            >
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-black text-white shrink-0">
                {emp.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{emp.name}</p>
                <p className="text-[10px] text-slate-400 truncate">
                  {emp.fileNumber ? <span className="text-slate-300 font-mono">#{emp.fileNumber}</span> : null}
                  {emp.fileNumber && emp.empresa ? <span className="mx-1">·</span> : null}
                  {emp.empresa ? <span>{emp.empresa}</span> : null}
                </p>
              </div>
            </button>
            <button
              type="button"
              title="QR preview producción"
              onClick={() => setQrEmpId(qrEmpId === emp.id ? null : emp.id)}
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${qrEmpId === emp.id ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        ))}
        {filtered.length === 0 && employees.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">Cargando guardias...</p>
        ) : null}
        {filtered.length === 0 && employees.length > 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">Sin resultados para &quot;{search}&quot;</p>
        ) : null}
        {filtered.length > 80 ? (
          <p className="text-slate-600 text-[11px] text-center py-3">Mostrando 80 de {filtered.length} — refiná la búsqueda</p>
        ) : null}
      </div>

      {qrEmp ? (
        <div className="px-4 py-3 border-t border-slate-800 shrink-0">
          <MobilePreviewQrPanel empDocId={qrEmp.id} employeeName={qrEmp.name} compact />
        </div>
      ) : null}
    </div>
  );
}

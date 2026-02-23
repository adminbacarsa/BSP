import React from 'react';
import { Trash2, FileText } from 'lucide-react';
import { SHIFT_STYLES } from '@/pages/admin/planificacion/auditplan/constants';

export const ShiftSelectorModal = ({
  selectedCell,
  employees,
  positionStructure,
  activePosition,
  setActivePosition,
  onAssign,
  onDelete,
  onRRHH,
  onClose,
}: any) => {
  if (!selectedCell) return null;
  const emp = employees.find((e: any) => e.id === selectedCell.empId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="bg-white p-10 rounded-[3rem] w-[500px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-8 border-b pb-4">
          <div>
            <h3 className="font-black text-2xl text-slate-800 uppercase">{emp?.name}</h3>
            <p className="text-xs font-bold text-indigo-500">{selectedCell.dateStr}</p>
          </div>
          <button onClick={onDelete} className="p-3 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-500 hover:text-white">
            <Trash2 />
          </button>
        </div>

        <div className="mb-6 bg-slate-50 p-4 rounded-2xl">
          <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Puesto</label>
          <select value={activePosition} onChange={(e) => setActivePosition(e.target.value)} className="w-full p-3 rounded-xl border-2 font-bold">
            {positionStructure.map((p: any) => (
              <option key={p.positionName} value={p.positionName}>
                {p.positionName}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-6">
          {['M', 'T', 'N', 'F', 'D12', 'N12'].map((code) => (
            <button key={code} onClick={() => onAssign(code)} className={'p-4 rounded-2xl border font-black ' + SHIFT_STYLES[code]}>
              {code}
            </button>
          ))}
        </div>

        <button onClick={onRRHH} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black flex items-center justify-center gap-3">
          <FileText size={20} /> RRHH
        </button>
      </div>
    </div>
  );
};

export const RRHHModal = ({ onSubmit, onClose }: any) => (
  <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md">
    <div className="bg-white p-10 rounded-[3rem] w-[400px] shadow-2xl">
      <h3 className="text-2xl font-black uppercase mb-8 border-b pb-4">Novedad RRHH</h3>
      <button onClick={onSubmit} className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl mb-4 shadow-lg">
        REGISTRAR
      </button>
      <button onClick={onClose} className="w-full py-2 font-bold text-slate-400">
        Cerrar
      </button>
    </div>
  </div>
);


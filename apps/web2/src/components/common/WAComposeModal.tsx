import React, { useState, useEffect } from 'react';
import { X, MessageCircle, Send, ChevronDown, Phone } from 'lucide-react';
import { openWhatsApp, waMensaje, normalizeArgPhone } from '@/lib/whatsapp';

export interface WAComposeContext {
  employeeName: string;
  phone: string;
  objectiveName?: string;
  horaInicio?: string;
  horaFin?: string;
  fecha?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ctx: WAComposeContext;
}

interface Template {
  id: string;
  label: string;
  build: () => string;
}

export function WAComposeModal({ isOpen, onClose, ctx }: Props) {
  const { employeeName, phone, objectiveName = '', horaInicio = '', horaFin = '', fecha = '' } = ctx;

  const templates: Template[] = [
    { id: 'bienvenida',   label: 'Saludo / Contacto rápido',     build: () => waMensaje.bienvenida(employeeName) },
    ...(objectiveName && horaInicio && horaFin ? [
      { id: 'cobertura',  label: 'Solicitar cobertura urgente',  build: () => waMensaje.cobertura(employeeName, objectiveName, horaInicio, horaFin) },
      { id: 'adelanto',   label: 'Pedir adelanto de ingreso',    build: () => waMensaje.adelanto(employeeName, objectiveName, horaInicio) },
      { id: 'intercambio',label: 'Solicitar intercambio',        build: () => waMensaje.intercambio(employeeName, objectiveName) },
      { id: 'tardanza',   label: 'Consultar llegada tarde',      build: () => waMensaje.tardanza(employeeName, objectiveName, horaInicio) },
    ] : []),
    ...(fecha && objectiveName && horaInicio && horaFin ? [
      { id: 'recordatorio', label: 'Recordatorio de turno',      build: () => waMensaje.turnoRecordatorio(employeeName, objectiveName, fecha, horaInicio, horaFin) },
    ] : []),
    ...(fecha && objectiveName ? [
      { id: 'ausencia',   label: 'Notificar ausencia registrada', build: () => waMensaje.ausencia(employeeName, fecha, objectiveName) },
    ] : []),
  ];

  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');
  const [message, setMessage]       = useState(templates[0]?.build() ?? '');

  // Actualiza el mensaje cuando cambia la plantilla o el contexto
  useEffect(() => {
    const t = templates.find(t => t.id === selectedId);
    if (t) setMessage(t.build());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, employeeName, objectiveName, horaInicio, horaFin, fecha]);

  // Resetea al abrir
  useEffect(() => {
    if (isOpen && templates.length) {
      setSelectedId(templates[0].id);
      setMessage(templates[0].build());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const normalized = normalizeArgPhone(phone);

  const handleSend = () => {
    openWhatsApp(phone, message);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">

        {/* Header verde WA */}
        <div className="p-4 flex justify-between items-center text-white" style={{ background: '#25D366' }}>
          <h3 className="font-black uppercase text-sm flex items-center gap-2">
            <MessageCircle size={18} />
            WhatsApp — {employeeName}
          </h3>
          <button onClick={onClose} className="bg-white/20 p-1 rounded-lg hover:bg-white/30 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Destinatario */}
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Para</p>
            <div className="flex items-center gap-2">
              <Phone size={14} className="text-slate-400 shrink-0" />
              {phone
                ? <span className="text-sm font-semibold text-slate-700">{employeeName} · {phone}</span>
                : <span className="text-sm font-semibold text-rose-500">Sin teléfono registrado</span>
              }
            </div>
          </div>

          {/* Selector de plantilla */}
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Plantilla</p>
            <div className="relative">
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full p-2.5 pr-8 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 appearance-none bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
              >
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-3 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Preview / editor del mensaje */}
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mb-1">Mensaje (editable)</p>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
              className="w-full p-3 border border-slate-200 rounded-xl text-sm text-slate-700 resize-none font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#25D366]/30"
              style={{ background: '#f0fdf4' }}
            />
            <p className="text-[10px] text-slate-400 mt-1 text-right">{message.length} caracteres</p>
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSend}
              disabled={!phone || !message.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 text-white font-black rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: phone ? '#25D366' : '#94a3b8' }}
              onMouseOver={e => { if (phone) (e.currentTarget as HTMLButtonElement).style.background = '#1ebe5d'; }}
              onMouseOut={e => { if (phone) (e.currentTarget as HTMLButtonElement).style.background = '#25D366'; }}
            >
              <Send size={15} />
              ABRIR WHATSAPP
            </button>
            <button
              onClick={onClose}
              className="px-4 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors text-sm"
            >
              Cancelar
            </button>
          </div>

          {!phone && (
            <p className="text-[10px] text-rose-500 font-semibold text-center -mt-2">
              ⚠ Completá el teléfono en el perfil del empleado para habilitar WhatsApp.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

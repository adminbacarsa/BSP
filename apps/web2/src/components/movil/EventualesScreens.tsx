import { Phone } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { MovilBadge } from './ui/MovilBadge';
import { MovilCard } from './ui/MovilCard';
import { MovilTopBar } from './ui/MovilTopBar';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_TEXT } from './ui/tones';

export type EventualesPanel = 'bolsa' | 'arca' | 'alta';

export type EventualMovil = {
  id: string;
  nombre: string;
  cuil: string;
  marco: string;
  marcoVigente?: boolean;
  telefono: string;
  /** «Legajo 1001 · 1º ingreso 15/02/2024» (vacío si la ficha no lo tiene). */
  legajoIngreso?: string;
  disponible?: boolean;
};

export type ArcaMovil = {
  id: string;
  nombre: string;
  tipo: string;
  estado: string;
};

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-[var(--movil-primary,#111827)]';
const BTN_PRIMARY = `min-h-12 w-full rounded-lg text-sm font-semibold active:opacity-90 disabled:opacity-40 ${MOVIL_BTN_PRIMARY}`;
const BTN_SECONDARY = `flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-semibold active:bg-slate-50 ${MOVIL_BTN_SECONDARY}`;

export function EventualesScreens(props: {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  panel: EventualesPanel;
  buscar: string;
  onBuscar: (value: string) => void;
  personas: EventualMovil[];
  onElegir: (id: string) => void;
  onCerrarAlta: () => void;
  cuil: string;
  onCuil: (value: string) => void;
  cuilEstado: string;
  nombre: string;
  onNombre: (value: string) => void;
  mail: string;
  onMail: (value: string) => void;
  telefono: string;
  onTelefono: (value: string) => void;
  onGuardarAlta: () => void;
  onCrearAcceso: () => void;
  arca: ArcaMovil[];
  nro: string;
  onNro: (value: string) => void;
  arcaId: string;
  onArca: (id: string) => void;
  onConfirmarArca: () => void;
  elegido: EventualMovil | null;
}) {
  return (
    <div data-movil-screen={props.panel} data-viewport="390x844" className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`}>
      <MovilTopBar modulo="Eventuales" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      <div className="flex flex-1 flex-col gap-2 px-3 py-3">
        {props.panel !== 'arca' && (
          <>
            <input type="search" value={props.buscar} onChange={(event) => props.onBuscar(event.target.value)} placeholder="Buscar en la bolsa" className={`h-9 text-base ${INPUT}`} />
            {props.personas.map((persona) => (
              <MovilCard
                key={persona.id}
                ring={persona.disponible === false ? 'slate' : persona.marcoVigente ? 'emerald' : 'amber'}
                title={persona.nombre}
                subtitle={persona.legajoIngreso || persona.cuil}
                badge={<MovilBadge tone={persona.marcoVigente ? 'emerald' : 'amber'}>{persona.marco}</MovilBadge>}
                onClick={() => props.onElegir(persona.id)}
                attrs={{ 'data-eventual': persona.id, 'data-eventual-legajo': persona.legajoIngreso ? '1' : '0' }}
              />
            ))}
            {props.personas.length === 0 && <p className={`${MOVIL_CARD} p-4 text-[13px] text-slate-500`}>Nadie en la bolsa con ese nombre.</p>}
            {props.elegido && (
              <section className={`${MOVIL_CARD} p-4`} data-eventual-ficha={props.elegido.id}>
                <h2 className="text-base font-semibold text-slate-900">{props.elegido.nombre}</h2>
                <p className="mt-1 text-[13px] text-slate-700">{props.elegido.cuil}</p>
                {props.elegido.legajoIngreso && <p className="text-[12px] text-slate-500">{props.elegido.legajoIngreso}</p>}
                <p className={`mt-1 text-[12px] font-semibold ${props.elegido.marcoVigente ? 'text-emerald-600' : 'text-amber-600'}`}>{props.elegido.marco}</p>
                {props.elegido.telefono && (
                  <a href={`tel:${props.elegido.telefono}`} className={`mt-3 ${BTN_SECONDARY}`}>
                    <Phone size={15} strokeWidth={1.75} aria-hidden="true" /> Llamar
                  </a>
                )}
                <button type="button" onClick={props.onCrearAcceso} className={`mt-2 ${BTN_PRIMARY}`}>
                  {props.online ? 'Crear acceso a la app' : 'Crear acceso requiere conexión'}
                </button>
              </section>
            )}
          </>
        )}
        {props.panel === 'arca' && (
          <section className={`${MOVIL_CARD} p-4`}>
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">ARCA pendiente</h2>
            <ul className="mt-1 divide-y divide-[#eceef1]">
              {props.arca.map((envio) => (
                <li key={envio.id}>
                  <button type="button" onClick={() => props.onArca(envio.id)} aria-pressed={props.arcaId === envio.id} className="flex min-h-12 w-full items-center justify-between gap-2 text-left">
                    <span className={`text-sm font-semibold ${props.arcaId === envio.id ? MOVIL_PRIMARY_TEXT : 'text-slate-900'}`}>{envio.nombre}</span>
                    <MovilBadge outline tone="amber">{envio.tipo} {envio.estado}</MovilBadge>
                  </button>
                </li>
              ))}
              {props.arca.length === 0 && <li className="py-2 text-[13px] text-slate-500">Sin altas ni bajas pendientes.</li>}
            </ul>
            <input value={props.nro} onChange={(event) => props.onNro(event.target.value)} placeholder="Número de transacción" className={`mt-3 min-h-11 text-base ${INPUT} tabular-nums`} />
            <button type="button" onClick={props.onConfirmarArca} className={`mt-2 ${BTN_PRIMARY}`}>
              {props.online ? 'Cargar transacción' : 'ARCA requiere conexión'}
            </button>
          </section>
        )}
      </div>
      <BottomSheet open={props.panel === 'alta'} title="Alta rápida" onClose={props.onCerrarAlta}>
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">CUIL
          <input value={props.cuil} onChange={(event) => props.onCuil(event.target.value)} inputMode="numeric" className={`mt-1 min-h-11 text-base ${INPUT} tabular-nums`} />
        </label>
        <p className={`mt-1 h-4 text-[12px] font-medium ${props.cuilEstado.includes('válido') && !props.cuilEstado.includes('inválido') ? 'text-emerald-600' : 'text-amber-600'}`}>{props.cuilEstado}</p>
        <input value={props.nombre} onChange={(event) => props.onNombre(event.target.value)} placeholder="Apellido y nombre" className={`mt-2 min-h-11 text-base ${INPUT}`} />
        <input value={props.mail} onChange={(event) => props.onMail(event.target.value)} placeholder="Mail" inputMode="email" className={`mt-2 min-h-11 text-base ${INPUT}`} />
        <input value={props.telefono} onChange={(event) => props.onTelefono(event.target.value)} placeholder="Teléfono" inputMode="tel" className={`mt-2 min-h-11 text-base ${INPUT}`} />
        <p className="mt-2 text-[12px] text-slate-500">Empresa habilitada: {props.empresa}</p>
        <button type="button" onClick={props.onGuardarAlta} className={`mt-3 ${BTN_PRIMARY}`}>
          {props.online ? 'Guardar en la bolsa' : 'El alta requiere conexión'}
        </button>
      </BottomSheet>
    </div>
  );
}

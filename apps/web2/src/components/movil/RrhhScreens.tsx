import { Phone } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { MovilBadge } from './ui/MovilBadge';
import { MovilTopBar } from './ui/MovilTopBar';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_BG, MOVIL_PRIMARY_TEXT } from './ui/tones';

export type RrhhPanel = 'dia' | 'ausencia' | 'novedad' | 'ficha';

export type GuardiaMovil = { id: string; nombre: string; telefono: string };
export type TipoMovil = { id: string; label: string; code: string };
export type TurnoSemana = { id: string; dia: string; codigo: string };
export type AusenciaHoyMovil = { id: string; employeeId: string; nombre: string; tipo: string; justificable?: boolean };

export type JustificarMovil = {
  id: string;
  nombre: string;
  tipos: TipoMovil[];
  tipoId: string;
  fotoNombre: string | null;
};

const NOVEDAD_TIPOS = ['Observación', 'Incidente', 'Uniforme', 'Otro'] as const;

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none focus:border-[var(--movil-primary,#111827)]';
const CHIP = 'min-h-10 rounded-md border px-3 text-[13px] font-medium';
const CHIP_OFF = `${CHIP} border-slate-300 bg-white text-slate-700`;
const CHIP_ON = `${CHIP} border-transparent ${MOVIL_PRIMARY_BG}`;
const BTN_PRIMARY = `min-h-12 w-full rounded-lg text-sm font-semibold active:opacity-90 ${MOVIL_BTN_PRIMARY}`;
const BTN_SECONDARY = `flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-semibold active:bg-slate-50 ${MOVIL_BTN_SECONDARY}`;

export function RrhhScreens(props: {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  panel: RrhhPanel;
  hoyLabel: string;
  ausenciasHoy: AusenciaHoyMovil[];
  licencias: { id: string; employeeId: string; nombre: string; detalle: string }[];
  certificados: { id: string; employeeId: string; nombre: string }[];
  busqueda: string;
  onBusqueda: (value: string) => void;
  guardias: GuardiaMovil[];
  tipos: TipoMovil[];
  tipoId: string;
  onTipo: (id: string) => void;
  dias: string;
  onDias: (value: string) => void;
  fotoNombre: string | null;
  onFoto: (file: File | null) => void;
  onGuardarAusencia: () => void;
  novedadTipo: string;
  onNovedadTipo: (value: string) => void;
  novedadTexto: string;
  onNovedadTexto: (value: string) => void;
  onGuardarNovedad: () => void;
  ficha: { nombre: string; telefono: string; turnos: TurnoSemana[] } | null;
  onElegir: (id: string) => void;
  onFicha: (id: string) => void;
  onPanel: (panel: RrhhPanel) => void;
  /** Justificar la AA del día: abre la hoja con el tipo (E/L/A) y el certificado. */
  onJustificar?: (ausenciaId: string) => void;
  justificar?: JustificarMovil | null;
  onJustificarTipo?: (tipoId: string) => void;
  onJustificarFoto?: (file: File | null) => void;
  onJustificarGuardar?: () => void;
  onJustificarCerrar?: () => void;
}) {
  const guardar = props.online ? 'Guardar' : 'Guardar · pendiente de enviar';
  return (
    <div data-movil-screen data-viewport="390x844" className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`}>
      <MovilTopBar modulo="RRHH" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      <div className="flex flex-1 flex-col gap-3 px-3 pt-1">
        <p className="h-5 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">{props.hoyLabel}</p>
        {props.panel === 'dia' && (
          <>
            <Tarjeta
              titulo="Ausencias de hoy"
              vacio="Nadie ausente hoy."
              items={props.ausenciasHoy.map((row) => ({
                key: row.id,
                id: row.employeeId,
                titulo: row.nombre,
                detalle: row.tipo,
                tono: row.justificable ? 'rose' : undefined,
                accion: row.justificable && props.onJustificar ? { label: 'Justificar', onClick: () => props.onJustificar?.(row.id), attr: row.id } : undefined,
              }))}
              onOpen={props.onFicha}
            />
            <Tarjeta titulo="Licencias que empiezan o terminan" vacio="Ninguna licencia cambia hoy." items={props.licencias.map((row) => ({ key: row.id, id: row.employeeId, titulo: row.nombre, detalle: row.detalle }))} onOpen={props.onFicha} />
            <Tarjeta titulo="Certificados pendientes" vacio="Sin certificados pendientes." items={props.certificados.map((row) => ({ key: row.id, id: row.employeeId, titulo: row.nombre, detalle: 'Falta la foto', tono: 'amber' }))} onOpen={props.onFicha} />
          </>
        )}
        {props.panel === 'ausencia' && (
          <section className={`${MOVIL_CARD} p-4`}>
            <h2 className="text-base font-semibold text-slate-900">Cargar ausencia</h2>
            <input
              value={props.busqueda}
              onChange={(event) => props.onBusqueda(event.target.value)}
              placeholder="Buscar guardia"
              className={`mt-3 min-h-11 text-base ${INPUT}`}
            />
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
              {props.guardias.map((guardia) => (
                <li key={guardia.id}>
                  <button type="button" onClick={() => props.onElegir(guardia.id)} className="min-h-11 w-full rounded-md border border-[#eceef1] bg-white px-3 text-left text-sm font-medium text-slate-800 active:bg-slate-50">
                    {guardia.nombre}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {props.tipos.map((tipo) => (
                <button key={tipo.id} type="button" onClick={() => props.onTipo(tipo.id)} aria-pressed={props.tipoId === tipo.id} className={props.tipoId === tipo.id ? CHIP_ON : CHIP_OFF}>
                  <b className="font-semibold">{tipo.code}</b> {tipo.label}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Días
              <input value={props.dias} onChange={(event) => props.onDias(event.target.value)} inputMode="numeric" className={`mt-1 min-h-11 text-base ${INPUT} font-semibold`} />
            </label>
            <label className={`mt-3 cursor-pointer ${BTN_SECONDARY}`}>
              {props.fotoNombre || 'Foto del certificado'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => props.onFoto(event.target.files?.[0] || null)} />
            </label>
            <button type="button" onClick={props.onGuardarAusencia} className={`mt-3 ${BTN_PRIMARY}`}>
              {guardar}
            </button>
          </section>
        )}
        {props.panel === 'novedad' && (
          <section className={`${MOVIL_CARD} p-4`}>
            <h2 className="text-base font-semibold text-slate-900">Novedad rápida</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {NOVEDAD_TIPOS.map((tipo) => (
                <button key={tipo} type="button" onClick={() => props.onNovedadTipo(tipo)} aria-pressed={props.novedadTipo === tipo} className={props.novedadTipo === tipo ? CHIP_ON : CHIP_OFF}>
                  {tipo}
                </button>
              ))}
            </div>
            <textarea value={props.novedadTexto} onChange={(event) => props.onNovedadTexto(event.target.value)} placeholder="Qué pasó" className={`mt-3 min-h-28 text-base ${INPUT} p-3`} />
            <button type="button" onClick={props.onGuardarNovedad} className={`mt-3 ${BTN_PRIMARY}`}>
              {guardar}
            </button>
          </section>
        )}
        {props.panel === 'ficha' && props.ficha && (
          <section className={`${MOVIL_CARD} p-4`}>
            <button type="button" onClick={() => props.onPanel('dia')} className={`text-xs font-semibold ${MOVIL_PRIMARY_TEXT}`}>Volver</button>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">{props.ficha.nombre}</h2>
            {props.ficha.telefono ? (
              <a href={`tel:${props.ficha.telefono}`} className={`mt-3 ${BTN_SECONDARY}`}>
                <Phone size={15} strokeWidth={1.75} aria-hidden="true" /> Llamar
              </a>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Sin teléfono</p>
            )}
            <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Turnos de la semana</h3>
            <ul className="mt-2 divide-y divide-[#eceef1]">
              {props.ficha.turnos.map((turno) => (
                <li key={turno.id} className="flex min-h-11 items-center justify-between text-sm text-slate-800">
                  <span>{turno.dia}</span>
                  <MovilBadge outline size="md" tone="slate">{turno.codigo || '—'}</MovilBadge>
                </li>
              ))}
              {props.ficha.turnos.length === 0 && <li className="py-2 text-sm text-slate-500">Sin turnos esta semana.</li>}
            </ul>
          </section>
        )}
      </div>
      <BottomSheet open={!!props.justificar} title="Justificar ausencia" onClose={() => props.onJustificarCerrar?.()}>
        {props.justificar && (
          <div data-rrhh-justificar={props.justificar.id}>
            <p className="text-[13px] text-slate-700">{props.justificar.nombre}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">La AA del día pasa al tipo elegido; los turnos de la planificación se actualizan igual que en la computadora.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {props.justificar.tipos.map((tipo) => (
                <button key={tipo.id} type="button" onClick={() => props.onJustificarTipo?.(tipo.id)} aria-pressed={props.justificar?.tipoId === tipo.id} className={props.justificar?.tipoId === tipo.id ? CHIP_ON : CHIP_OFF}>
                  <b className="font-semibold">{tipo.code}</b> {tipo.label}
                </button>
              ))}
            </div>
            <label className={`mt-3 cursor-pointer ${BTN_SECONDARY}`}>
              {props.justificar.fotoNombre || 'Foto del certificado'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => props.onJustificarFoto?.(event.target.files?.[0] || null)} />
            </label>
            <button type="button" onClick={() => props.onJustificarGuardar?.()} className={`mt-3 ${BTN_PRIMARY}`}>
              {props.online ? 'Justificar' : 'Justificar · pendiente de enviar'}
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function Tarjeta(props: {
  titulo: string;
  vacio: string;
  items: {
    key: string;
    id: string;
    titulo: string;
    detalle: string;
    tono?: 'rose' | 'amber';
    accion?: { label: string; onClick: () => void; attr?: string };
  }[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className={`${MOVIL_CARD} p-3`}>
      <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{props.titulo}</h2>
      <ul className="mt-1 divide-y divide-[#eceef1]">
        {props.items.map((item) => (
          <li key={item.key} className="flex min-h-12 items-center gap-2 py-1">
            <button type="button" onClick={() => props.onOpen(item.id)} className="flex min-w-0 flex-1 flex-col items-start text-left">
              <span className="truncate text-sm font-semibold text-slate-900">{item.titulo}</span>
              <span className={`text-[11px] font-medium ${item.tono === 'rose' ? 'text-rose-600' : item.tono === 'amber' ? 'text-amber-600' : 'text-slate-500'}`}>{item.detalle}</span>
            </button>
            {item.accion && (
              <button type="button" onClick={item.accion.onClick} data-rrhh-accion={item.accion.attr} className={`min-h-9 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-900 active:bg-slate-50`}>
                {item.accion.label}
              </button>
            )}
          </li>
        ))}
        {props.items.length === 0 && <li className="py-2 text-sm text-slate-500">{props.vacio}</li>}
      </ul>
    </section>
  );
}

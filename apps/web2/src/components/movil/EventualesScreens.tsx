import type { ReactNode } from 'react';
import { cuentaRegresivaAnulacion, PASOS_ANULACION_MANUAL } from '@/lib/eventuales/plazoAnulacion.mjs';
import { BottomSheet } from './BottomSheet';
import { MovilBadge } from './ui/MovilBadge';
import { MovilTopBar } from './ui/MovilTopBar';
import { MOVIL_BTN_PRIMARY, MOVIL_BTN_SECONDARY, MOVIL_CARD, MOVIL_FILETE, MOVIL_FONT, type MovilTone } from './ui/tones';

export type EventualesPanel = 'bolsa' | 'arca' | 'alta' | 'escala';

export type EventualMovil = {
  id: string;
  nombre: string;
  cuil: string;
  marco: string;
  /** 'MARCO_VIGENTE' | 'VENCIDO' | 'SIN_MARCO' */
  marcoEstado: string;
  telefono: string;
  /** Número de legajo en la planilla de eventuales ('' si no tiene). */
  legajo: string;
  /** Primer ingreso en formato dd/MM/yyyy ('' si no se cargó). */
  primerIngreso: string;
  /** Switches de pruebas de la ficha (default true). */
  exigirMarco?: boolean;
  exigirAltaArca?: boolean;
  /** `estadoFila` del escritorio: «Listo para convocar» / «Falta: …» / «No disponible». */
  estadoTexto?: string;
  /** 'ok' | 'falta' | 'baja' */
  estadoTono?: string;
};

export type ArcaMovil = {
  id: string;
  nombre: string;
  cuil: string;
  /** 'AT' alta · 'BT' baja */
  tipo: string;
  /** PENDIENTE · ERROR · MANUAL · SUBIENDO · CONFIRMADO */
  estado: string;
  fecha: string;
  nroTransaccion: string;
  /** Anulación manual: CUIL de 11 dígitos, fecha AAAAMMDD y transacción del alta. */
  cuil11?: string;
  fechaInicioArca?: string;
  nroTransaccionAlta?: string;
  venceAnulacionMs?: number;
  pasos?: string[];
  observacionesInternas?: string;
  revista?: string;
};

const MARCO_TONE: Record<string, MovilTone> = {
  MARCO_VIGENTE: 'emerald',
  VENCIDO: 'rose',
  SIN_MARCO: 'slate',
};

/** Mismo tono que `estadoFila` del escritorio: listo verde, falta ámbar, no disponible gris. */
const ESTADO_RING: Record<string, MovilTone> = { ok: 'emerald', falta: 'amber', baja: 'slate' };
const ESTADO_TEXT: Record<string, string> = {
  ok: 'text-emerald-600',
  falta: 'text-amber-600',
  baja: 'text-slate-500',
};

const ARCA_ESTADO_TONE: Record<string, MovilTone> = {
  CONFIRMADO: 'emerald',
  ERROR: 'rose',
  MANUAL: 'amber',
  SUBIENDO: 'amber',
  PENDIENTE: 'slate',
  ANULADO: 'emerald',
};

export function arcaTipoTexto(tipo: string): string {
  if (tipo === 'AT') return 'Alta';
  if (tipo === 'BT') return 'Baja';
  if (tipo === 'ANULACION') return 'Anulación';
  if (tipo === 'BAJA_NO_PRESENTACION') return 'Baja';
  return tipo || 'Envío';
}

function AnulacionManualMovil(props: {
  envio: ArcaMovil;
  acuse: string;
  onAcuse?: (value: string) => void;
  onRegistrar?: () => void;
  ahoraMs?: number;
  online: boolean;
  enviando?: boolean;
}) {
  const plazo = cuentaRegresivaAnulacion(props.envio.venceAnulacionMs, props.ahoraMs ?? Date.now());
  const pasos = props.envio.pasos?.length ? props.envio.pasos : PASOS_ANULACION_MANUAL;
  return (
    <div data-anulacion-manual="1" className="mt-2 space-y-2">
      <p className="text-[12px] font-medium text-slate-500">Tarea manual en la web de ARCA. No se arma TXT por lote.</p>
      <dl className="space-y-1 text-[13px] font-semibold tabular-nums text-slate-900">
        <div className="flex justify-between gap-2"><dt className="font-medium text-slate-500">CUIL</dt><dd data-anula-cuil="1">{props.envio.cuil11 || '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="font-medium text-slate-500">Fecha de inicio</dt><dd data-anula-fecha="1">{props.envio.fechaInicioArca || '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="font-medium text-slate-500">Transacción del alta</dt><dd data-anula-nro="1">{props.envio.nroTransaccionAlta || '—'}</dd></div>
      </dl>
      <p data-anula-plazo={plazo.vencido ? 'vencido' : 'abierto'} className={`text-[12px] font-semibold ${plazo.vencido ? 'text-rose-700' : 'text-slate-700'}`}>
        Plazo RG 2988 · {plazo.texto}
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-[12px] font-medium text-slate-600">
        {pasos.map((paso) => <li key={paso}>{paso}</li>)}
      </ol>
      <input
        value={props.acuse}
        onChange={(event) => props.onAcuse?.(event.target.value)}
        placeholder="Acuse de anulación"
        disabled={plazo.vencido}
        className={`${INPUT} text-base disabled:bg-slate-50 disabled:text-slate-400`}
      />
      <button
        type="button"
        onClick={props.onRegistrar}
        disabled={plazo.vencido || props.acuse.trim().length < 3 || !props.online || props.enviando}
        className={`${BTN} ${MOVIL_BTN_PRIMARY} disabled:opacity-40`}
      >
        {plazo.vencido ? 'Plazo vencido' : props.enviando ? 'Guardando…' : 'Registrar acuse'}
      </button>
    </div>
  );
}

const INPUT = 'min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-[var(--movil-primary,#111827)]';
const BTN = 'flex min-h-12 w-full items-center justify-center rounded-lg text-sm font-semibold active:scale-[0.99]';

export function EventualesScreens(props: {
  empresa: string;
  onEmpresa?: () => void;
  online: boolean;
  pendingLabel: string | null;
  panel: EventualesPanel;
  buscar: string;
  onBuscar: (value: string) => void;
  personas: EventualMovil[];
  /** Total de fichas habilitadas en la empresa activa (antes del buscador). */
  totalEmpresa?: number;
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
  /** 'M' | 'F' | '' (sin especificar). Cupo por género en eventos. */
  genero?: string;
  onGenero?: (value: string) => void;
  onGuardarAlta: () => void;
  onCrearAcceso: () => void;
  arca: ArcaMovil[];
  arcaCargando?: boolean;
  onRecargarArca?: () => void;
  nro: string;
  onNro: (value: string) => void;
  arcaId: string;
  onArca: (id: string) => void;
  onConfirmarArca: () => void;
  /** Acuse de la anulación hecha a mano en la web de ARCA. */
  acuse?: string;
  onAcuse?: (value: string) => void;
  onRegistrarAcuse?: () => void;
  ahoraMs?: number;
  arcaEnviando?: boolean;
  elegido: EventualMovil | null;
  /** Switches de pruebas: solo SuperAdmin o RRHH con EVENTUALES.update. */
  puedeSwitch?: boolean;
  switchGuardando?: string;
  onSwitch?: (campo: 'exigirMarco' | 'exigirAltaArca', valor: boolean) => void;
  /** Panel «Escala» (solo lectura): lo arma el contenedor para que esta pantalla no dependa de Firestore. */
  escala?: ReactNode;
}) {
  const envioElegido = props.arca.find((envio) => envio.id === props.arcaId) || null;
  const pendientes = props.arca.filter((envio) => envio.estado !== 'CONFIRMADO' && envio.estado !== 'ANULADO');
  const confirmados = props.arca.filter((envio) => envio.estado === 'CONFIRMADO' || envio.estado === 'ANULADO');
  return (
    <div data-movil-screen={props.panel} data-viewport="390x844" className={`mx-auto flex min-h-[844px] w-full max-w-[390px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-24 ${MOVIL_FONT}`}>
      <MovilTopBar modulo="Eventuales" empresa={props.empresa} onEmpresa={props.onEmpresa} online={props.online} pendingLabel={props.pendingLabel} />
      <div className="flex flex-1 flex-col gap-3 px-3 py-3">
        {props.panel === 'escala' && (props.escala || <p className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>Escala salarial · solo lectura en el celular.</p>)}
        {props.panel !== 'arca' && props.panel !== 'escala' && (
          <>
            <input value={props.buscar} onChange={(event) => props.onBuscar(event.target.value)} placeholder="Buscar por nombre, CUIL o legajo" className={`${INPUT} text-base`} />
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Bolsa · {props.empresa}{typeof props.totalEmpresa === 'number' ? ` · ${props.totalEmpresa} habilitado${props.totalEmpresa === 1 ? '' : 's'}` : ''}
            </p>
            <ul className="space-y-2" data-movil-list="bolsa">
              {props.personas.map((persona) => (
                <li key={persona.id}>
                  <button
                    type="button"
                    onClick={() => props.onElegir(persona.id)}
                    data-eventual={persona.id}
                    data-estado-fila={persona.estadoTexto || undefined}
                    className={`relative ${MOVIL_CARD} w-full p-3 text-left active:bg-slate-50 ${persona.estadoTexto ? 'pl-4' : ''} ${props.elegido?.id === persona.id ? 'border-slate-400' : ''}`}
                  >
                    {persona.estadoTexto && (
                      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-lg ${MOVIL_FILETE[ESTADO_RING[persona.estadoTono || ''] || 'slate']}`} />
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-[15px] font-semibold leading-tight text-slate-900">{persona.nombre}</span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1">
                        {persona.exigirMarco === false && <MovilBadge tone="slate" outline>Pruebas: sin exigir marco</MovilBadge>}
                        {!persona.estadoTexto && <MovilBadge tone={MARCO_TONE[persona.marcoEstado] || 'slate'}>{persona.marco}</MovilBadge>}
                      </span>
                    </div>
                    {persona.estadoTexto && (
                      <p className={`mt-0.5 text-[12px] font-semibold leading-snug ${ESTADO_TEXT[persona.estadoTono || ''] || 'text-slate-500'}`}>{persona.estadoTexto}</p>
                    )}
                    <dl className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] font-medium text-slate-500">
                      <div>
                        <dt className="uppercase tracking-wide">Legajo</dt>
                        <dd className="text-[13px] font-semibold tabular-nums text-slate-900" data-legajo={persona.legajo || 'sin'}>{persona.legajo || '—'}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide">1º ingreso</dt>
                        <dd className="text-[13px] font-semibold tabular-nums text-slate-900" data-primer-ingreso={persona.primerIngreso || 'sin'}>{persona.primerIngreso || '—'}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-wide">CUIL</dt>
                        <dd className="text-[13px] font-semibold tabular-nums text-slate-900">{persona.cuil}</dd>
                      </div>
                    </dl>
                  </button>
                </li>
              ))}
              {props.personas.length === 0 && <li className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>Nadie en la bolsa de {props.empresa} con ese dato.</li>}
            </ul>
            {props.elegido && (
              <section className={`${MOVIL_CARD} p-4`} data-movil-ficha={props.elegido.id}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{props.elegido.nombre}</h2>
                  {!props.elegido.estadoTexto && <MovilBadge tone={MARCO_TONE[props.elegido.marcoEstado] || 'slate'}>{props.elegido.marco}</MovilBadge>}
                </div>
                {props.elegido.estadoTexto && (
                  <p data-estado-ficha={props.elegido.estadoTexto} className={`mt-1 border-l-[3px] pl-2 text-[13px] font-semibold ${ESTADO_TEXT[props.elegido.estadoTono || ''] || 'text-slate-500'} ${props.elegido.estadoTono === 'ok' ? 'border-emerald-500' : props.elegido.estadoTono === 'falta' ? 'border-amber-500' : 'border-slate-300'}`}>{props.elegido.estadoTexto}</p>
                )}
                <p className="mt-1 text-sm font-medium tabular-nums text-slate-600">
                  {props.elegido.cuil}
                  {props.elegido.legajo ? ` · Legajo ${props.elegido.legajo}` : ' · Sin legajo'}
                  {props.elegido.primerIngreso ? ` · 1º ingreso ${props.elegido.primerIngreso}` : ''}
                </p>
                {(props.elegido.exigirMarco === false || props.elegido.exigirAltaArca === false) && (
                  <div className="mt-2 flex flex-wrap gap-1" data-pruebas="sin-marco">
                    {props.elegido.exigirMarco === false && <MovilBadge tone="slate" outline>Pruebas: sin exigir marco</MovilBadge>}
                    {props.elegido.exigirAltaArca === false && <MovilBadge tone="slate" outline>Pruebas: sin exigir alta ARCA</MovilBadge>}
                  </div>
                )}
                {props.puedeSwitch && props.onSwitch && (
                  <div className="mt-3 space-y-2" data-switches-pruebas>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Modo pruebas</p>
                    {([
                      { campo: 'exigirMarco' as const, label: 'Exigir contrato marco y habilitación', on: props.elegido.exigirMarco !== false },
                      { campo: 'exigirAltaArca' as const, label: 'Exigir alta ARCA para fichar', on: props.elegido.exigirAltaArca !== false },
                    ]).map((sw) => (
                      <button
                        key={sw.campo}
                        type="button"
                        role="switch"
                        aria-checked={sw.on}
                        data-switch={sw.campo}
                        data-on={sw.on ? '1' : '0'}
                        disabled={!props.online || props.switchGuardando === sw.campo}
                        onClick={() => props.onSwitch?.(sw.campo, !sw.on)}
                        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm font-semibold disabled:opacity-50 ${sw.on ? 'border-slate-200 bg-white text-slate-900' : 'border-slate-300 bg-white text-slate-600'}`}
                      >
                        <span>{sw.label}</span>
                        <span className={`shrink-0 text-[11px] font-bold uppercase ${sw.on ? 'text-emerald-700' : 'text-slate-500'}`}>{sw.on ? 'Sí' : 'No · pruebas'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {props.elegido.telefono && (
                  <a href={`tel:${props.elegido.telefono}`} className={`${BTN} ${MOVIL_BTN_SECONDARY} mt-3`}>Llamar</a>
                )}
                <button type="button" onClick={props.onCrearAcceso} className={`${BTN} ${MOVIL_BTN_PRIMARY} mt-2`}>
                  {props.online ? 'Crear acceso a la app' : 'Crear acceso requiere conexión'}
                </button>
              </section>
            )}
          </>
        )}
        {props.panel === 'arca' && (
          <>
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                ARCA pendiente · {props.empresa} · <span className="tabular-nums text-slate-900">{pendientes.length}</span>
              </p>
              {props.onRecargarArca && (
                <button type="button" onClick={props.onRecargarArca} disabled={!props.online || props.arcaCargando} className="text-[11px] font-semibold text-[var(--movil-primary,#111827)] disabled:text-slate-400">
                  {props.arcaCargando ? 'Actualizando…' : 'Actualizar'}
                </button>
              )}
            </div>
            <ul className="space-y-2" data-movil-list="arca">
              {pendientes.map((envio) => {
                const activo = props.arcaId === envio.id;
                return (
                  <li key={envio.id}>
                    <button
                      type="button"
                      onClick={() => props.onArca(envio.id)}
                      data-arca={envio.id}
                      data-arca-estado={envio.estado}
                      aria-pressed={activo}
                      className={`${MOVIL_CARD} w-full p-3 text-left active:bg-slate-50 ${activo ? 'border-slate-400' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold leading-tight text-slate-900">{envio.nombre}</span>
                        <MovilBadge tone={ARCA_ESTADO_TONE[envio.estado] || 'slate'}>{envio.estado}</MovilBadge>
                      </div>
                      <p className="mt-1 text-[12px] font-medium tabular-nums text-slate-500">
                        <span className="font-semibold text-slate-900">{arcaTipoTexto(envio.tipo)} {envio.tipo}</span>
                        {envio.fecha ? ` · ${envio.fecha}` : ''}
                        {envio.cuil ? ` · ${envio.cuil}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
              {pendientes.length === 0 && !props.arcaCargando && (
                <li className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>
                  {props.online ? `Sin altas ni bajas pendientes en ${props.empresa}.` : 'ARCA requiere conexión para ver los envíos.'}
                </li>
              )}
              {pendientes.length === 0 && props.arcaCargando && <li className={`${MOVIL_CARD} p-4 text-sm font-semibold text-slate-500`}>Buscando envíos…</li>}
            </ul>
            <section className={`${MOVIL_CARD} p-4`} data-movil-arca-form={envioElegido ? envioElegido.id : 'sin-envio'} data-arca-tarea={envioElegido?.tipo === 'ANULACION' ? 'manual' : 'transaccion'}>
              <h2 className="text-sm font-semibold text-slate-900">
                {envioElegido ? `${arcaTipoTexto(envioElegido.tipo)} ${envioElegido.tipo} · ${envioElegido.nombre}` : 'Elegí un envío de la lista'}
              </h2>
              {envioElegido?.tipo === 'ANULACION' ? (
                <AnulacionManualMovil envio={envioElegido} acuse={props.acuse || ''} onAcuse={props.onAcuse} onRegistrar={props.onRegistrarAcuse} ahoraMs={props.ahoraMs} online={props.online} enviando={props.arcaEnviando} />
              ) : (
              <>
              <p className="mt-1 text-[12px] font-medium text-slate-500">
                {envioElegido
                  ? 'Cargá el número de transacción que devolvió ARCA. El envío queda CONFIRMADO y la fichada del eventual se habilita.'
                  : 'Tocá el alta o la baja que ya presentaste en ARCA para cargar su número de transacción.'}
              </p>
              <input
                value={props.nro}
                onChange={(event) => props.onNro(event.target.value)}
                placeholder="Número de transacción"
                inputMode="numeric"
                disabled={!envioElegido}
                className={`${INPUT} text-base mt-3 disabled:bg-slate-50 disabled:text-slate-400`}
              />
              <button
                type="button"
                onClick={props.onConfirmarArca}
                disabled={!envioElegido || !props.nro.trim() || !props.online || props.arcaEnviando}
                className={`${BTN} ${MOVIL_BTN_PRIMARY} mt-2 disabled:opacity-40`}
              >
                {!props.online ? 'ARCA requiere conexión' : props.arcaEnviando ? 'Confirmando…' : 'Confirmar en ARCA'}
              </button>
              </>
              )}
            </section>
            {confirmados.length > 0 && (
              <>
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confirmados ahora</p>
                <ul className="space-y-2" data-movil-list="arca-confirmados">
                  {confirmados.map((envio) => (
                    <li key={envio.id} className={`${MOVIL_CARD} p-3`} data-arca={envio.id} data-arca-estado={envio.estado}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold leading-tight text-slate-900">{envio.nombre}</span>
                        <MovilBadge tone="emerald">{envio.estado}</MovilBadge>
                      </div>
                      <p className="mt-1 text-[12px] font-medium tabular-nums text-slate-500">
                        <span className="font-semibold text-slate-900">{arcaTipoTexto(envio.tipo)} {envio.tipo}</span>
                        {envio.nroTransaccion ? ` · Transacción ${envio.nroTransaccion}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      <BottomSheet open={props.panel === 'alta'} title="Alta rápida" onClose={props.onCerrarAlta}>
        <label className="block text-xs font-semibold uppercase text-slate-500">CUIL
          <input value={props.cuil} onChange={(event) => props.onCuil(event.target.value)} inputMode="numeric" className={`${INPUT} text-base mt-1 font-bold`} />
        </label>
        <p className="mt-1 text-xs font-semibold text-[var(--movil-primary,#111827)]">{props.cuilEstado}</p>
        <input value={props.nombre} onChange={(event) => props.onNombre(event.target.value)} placeholder="Apellido, Nombre" className={`${INPUT} text-base mt-2`} />
        <input value={props.mail} onChange={(event) => props.onMail(event.target.value)} placeholder="Mail" inputMode="email" className={`${INPUT} text-base mt-2`} />
        <input value={props.telefono} onChange={(event) => props.onTelefono(event.target.value)} placeholder="Teléfono" inputMode="tel" className={`${INPUT} text-base mt-2`} />
        <label className="mt-2 block text-xs font-semibold uppercase text-slate-500">Género
          <select data-alta-genero value={props.genero || ''} onChange={(event) => props.onGenero?.(event.target.value)} className={`${INPUT} text-base mt-1 bg-white`}>
            <option value="">Sin especificar</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </label>
        <p className="mt-2 text-xs font-semibold text-slate-500">Empresa habilitada: {props.empresa}</p>
        <button type="button" onClick={props.onGuardarAlta} className={`${BTN} ${MOVIL_BTN_PRIMARY} mt-3`}>
          {props.online ? 'Guardar en la bolsa' : 'El alta requiere conexión'}
        </button>
      </BottomSheet>
    </div>
  );
}

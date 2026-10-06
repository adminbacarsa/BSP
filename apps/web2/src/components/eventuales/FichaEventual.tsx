import { useState } from 'react';
import {
  ArrowLeft, Building2, Check, Download, Eye, FileText, FlaskConical, FolderOpen, History, Home, KeyRound, Landmark, Mail, Pencil, Phone,
  RefreshCw, RotateCcw, ShieldAlert, Upload, User, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { TabBar } from '@/components/ui';
import { ChecklistEventual, type PasoChecklist } from '@/components/eventuales/EventualesUx';
import ContratosEventual, { abrirPdfCallable, type ArcaVista, type ContratoVista } from '@/components/eventuales/ContratosEventual';
import { RNOS_DEFAULT_FICHA } from '@/lib/eventuales/ficha.mjs';
import { GENERO_LABEL } from '@/lib/eventuales/cupoGenero.mjs';
import { etiquetasPruebas, SWITCHES_PRUEBAS } from '@/lib/eventuales/pruebasSwitch.mjs';
import {
  fmtFechaAr, humanizar, iniciales, opcionesVigenciaMarco, textoDisponibilidad, textoEstadoMarco, textoLegajo, textoObraSocial, VIGENCIA_MARCO_DEFAULT,
} from '@/lib/eventuales/fichaUx.mjs';

export type EmpresaPlataforma = { id: string; nombre: string };

export type FichaEventualData = {
  id: string;
  nombre: string;
  disponibilidad: string;
  mail: string;
  telefono: string;
  dni: string;
  /** 'M' | 'F' | '' (sin especificar). Cupo por género en eventos. */
  genero: string;
  domicilio: string;
  empresasHabilitadas: string[];
  habilitacionNumero: string;
  habilitacionVencimiento: string;
  credencialVencimiento: string;
  aptoEstado: string;
  aptoVencimiento: string;
  riesgoEncadenamiento: string;
  uid: string;
  obraSocialRnos: string;
  fechaNacimiento: string;
  observaciones: string;
  localidad: string;
  legajoPlanilla: string;
  primerIngreso: string;
  arcaHistorial: { estado?: string; fecha?: string; origen?: string }[];
  marcos: Record<string, { firmado?: boolean; fechaFirma?: string; vigenciaDias?: number }>;
  /** Switches de pruebas (ausente = true). */
  exigirMarco: boolean;
  exigirAltaArca: boolean;
};

export type MarcoVista = { estado?: string; vencimiento?: string; avisar?: boolean };
export type DocumentoVista = { id: string; tipo?: string; nombre?: string; link?: string | null; drivePendiente?: boolean };
type Contrato = ContratoVista;
type Arca = ArcaVista & { codigoControl?: string | null; nroVerificador?: string | null; advertencias?: string[] };
type Historial = { id: string; action?: string; details?: string; at?: string | null };

type Props = {
  ficha: FichaEventualData;
  detalle: Record<string, unknown> | null;
  marcos: Record<string, MarcoVista>;
  documentos: DocumentoVista[];
  empresas: EmpresaPlataforma[];
  empresaActivaId: string;
  puede: (accion: string) => boolean;
  llamar: (nombre: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  recargar: () => void;
  onEditar: () => void;
  onAcceso: () => void;
  onBaja: (motivo: string, fecha: string) => Promise<void>;
  onReactivar: () => void;
  onVolver?: () => void;
  /** Horas del período en la empresa activa (`32/50 h este mes`). */
  horasMes?: { texto: string; aviso: boolean; usadas: number; tope: number; excepcion?: boolean; motivo?: string | null; topeEmpresa?: number; chip?: string | null; alcanzado?: boolean; cerca?: boolean } | null;
  /** Guarda o quita (horas null) la excepción de tope de esta persona. */
  onGuardarTope?: (horas: number | null, motivo: string) => Promise<void>;
  /** Lista de verificación (`checklistFicha`). Sin ella la ficha se ve como siempre. */
  checklist?: PasoChecklist[];
};

type Solapa = 'DATOS' | 'EMPRESAS' | 'DOCUMENTOS' | 'CONTRATOS' | 'ARCA' | 'HISTORIAL';

const hoy = () => new Date().toISOString().slice(0, 10);
const TONO: Record<string, string> = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pendiente: 'bg-amber-50 text-amber-800 border-amber-200',
  malo: 'bg-rose-50 text-rose-800 border-rose-200',
};

const HISTORIAL_LABEL: Record<string, string> = {
  EVENTUAL_ALTA: 'Alta en la bolsa',
  EVENTUAL_EDIT: 'Ficha editada',
  EVENTUAL_BAJA: 'Baja de la bolsa',
  EVENTUAL_REACTIVAR: 'Reactivado',
  EVENTUAL_ACCESO: 'Acceso a la app',
  EVENTUAL_MARCO: 'Contrato marco',
  EVENTUAL_EMPRESAS: 'Empresas habilitadas',
  EVENTUAL_CONTACTO: 'Datos de contacto importados',
  EVENTUAL_NOMINA: 'Nómina importada',
  EVENTUAL_DOC: 'Documento',
  EVENTUAL_SWITCH_PRUEBAS: 'Switch de pruebas',
  EVENTUAL_CONVOCADO_EVENTO: 'Convocado a evento',
  EVENTUAL_ACEPTO_EVENTO: 'Aceptó evento',
  EVENTUAL_CONVOCATORIA_VENCIDA: 'Convocatoria vencida',
};

type SwitchCampo = 'exigirMarco' | 'exigirAltaArca';

function SwitchPrueba({ campo, label, ayuda, on, disabled, busy, onChange }: { campo: SwitchCampo; label: string; ayuda: string; on: boolean; disabled: boolean; busy: boolean; onChange: (valor: boolean) => void }) {
  return (
    <label data-switch={campo} data-on={on ? '1' : '0'} className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${on ? 'border-slate-100 bg-slate-50/60' : 'border-fuchsia-200 bg-fuchsia-50/60'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled || busy}
        onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-fuchsia-500'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-slate-800">{label} <span className={`ml-1 text-[10px] font-black ${on ? 'text-emerald-700' : 'text-fuchsia-700'}`}>{on ? 'ON' : 'OFF · pruebas'}</span></span>
        <span className="block text-[10px] text-slate-500">{ayuda}</span>
      </span>
    </label>
  );
}

/** Botón con ícono y rótulo (cabecera de la ficha): nada queda solo con dibujo. */
function TextBtn({ title, label, onClick, children, tono = 'neutro', disabled }: { title?: string; label: string; onClick: () => void; children: React.ReactNode; tono?: 'neutro' | 'primario' | 'peligro' | 'ok'; disabled?: boolean }) {
  const clases = {
    neutro: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    primario: 'bg-indigo-600 text-white hover:bg-indigo-700',
    peligro: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50',
    ok: 'bg-emerald-600 text-white hover:bg-emerald-700',
  }[tono];
  return (
    <button type="button" title={title || label} onClick={onClick} disabled={disabled} className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold shadow-sm transition active:scale-95 disabled:opacity-50 ${clases}`}>
      {children} {label}
    </button>
  );
}

function Dato({ icon: Icon, label, valor, falta }: { icon?: React.ElementType; label: string; valor?: string; falta?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{Icon && <Icon size={11} />} {label}</p>
      <p className={`truncate text-sm font-semibold ${falta ? 'text-amber-700' : 'text-slate-800'}`} title={valor || ''}>{valor || (falta ? 'Falta' : '—')}</p>
    </div>
  );
}

async function base64De(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

export default function FichaEventual({ ficha, detalle, marcos, documentos, empresas, empresaActivaId, puede, llamar, recargar, onEditar, onAcceso, onBaja, onReactivar, onVolver, horasMes, onGuardarTope, checklist }: Props) {
  const [solapa, setSolapa] = useState<Solapa>('DATOS');
  const [bajaAbierta, setBajaAbierta] = useState(false);
  const [baja, setBaja] = useState({ motivo: '', fecha: hoy() });
  const [firmaFecha, setFirmaFecha] = useState(hoy());
  const [vigenciaDias, setVigenciaDias] = useState(String(VIGENCIA_MARCO_DEFAULT));
  const [empresaMarco, setEmpresaMarco] = useState('');
  const [archivoMarco, setArchivoMarco] = useState<File | null>(null);
  const [guardandoEmpresa, setGuardandoEmpresa] = useState('');
  const [guardandoSwitch, setGuardandoSwitch] = useState<SwitchCampo | ''>('');
  const [topeEx, setTopeEx] = useState('');
  const [motivoEx, setMotivoEx] = useState('');
  const [guardandoTope, setGuardandoTope] = useState(false);
  const etiquetasPrueba = etiquetasPruebas(ficha) as string[];

  const cambiarSwitch = async (campo: SwitchCampo, valor: boolean) => {
    setGuardandoSwitch(campo);
    try {
      await llamar('gestionarEventual', { accion: 'switchesPruebas', cuil: ficha.id, [campo]: valor });
      toast.success(valor ? 'Vuelve a exigirse.' : `Modo pruebas: ${SWITCHES_PRUEBAS.find((s) => s.campo === campo)?.etiquetaOff || 'sin exigir'}.`);
      recargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el switch.');
    } finally {
      setGuardandoSwitch('');
    }
  };

  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre || 'Empresa';
  const habilitadas = ficha.empresasHabilitadas;
  const empresaMarcoActual = habilitadas.includes(empresaMarco) ? empresaMarco : (habilitadas.includes(empresaActivaId) ? empresaActivaId : habilitadas[0] || '');
  const contratos = (detalle?.contratos as Contrato[]) || [];
  const arca = (detalle?.arca as Arca[]) || [];
  const historial = (detalle?.historial as Historial[]) || [];
  const rnos = detalle?.rnos as { pendiente?: boolean; sugerido?: boolean; sugerencia?: string; empresaId?: string } | undefined;
  const noDisponible = ficha.disponibilidad === 'NO_DISPONIBLE';
  const puedeLeer = puede('read') || puede('update') || puede('create');

  const toggleEmpresa = async (empresaId: string, habilitar: boolean) => {
    setGuardandoEmpresa(empresaId);
    try {
      await llamar('gestionarEventual', { accion: 'habilitarEmpresa', cuil: ficha.id, empresaId, habilitar });
      toast.success(habilitar ? `Habilitado en ${nombreEmpresa(empresaId)}.` : `Quitado de ${nombreEmpresa(empresaId)}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardandoEmpresa('');
    }
  };

  /** Botón de cada paso de la lista de verificación: resuelve ahí mismo, con las mismas acciones de siempre. */
  const resolverPaso = (accion: string) => {
    if (accion === 'EDITAR') { onEditar(); return; }
    if (accion === 'ACCESO') { onAcceso(); return; }
    if (accion === 'EMPRESA') {
      if (empresaActivaId && !habilitadas.includes(empresaActivaId)) { void toggleEmpresa(empresaActivaId, true); return; }
      setSolapa('EMPRESAS');
      return;
    }
    if (accion === 'MARCO') {
      setSolapa('EMPRESAS');
      if (empresaActivaId && habilitadas.includes(empresaActivaId)) setEmpresaMarco(empresaActivaId);
      return;
    }
    if (accion === 'TOPE') {
      const caja = document.querySelector<HTMLElement>('[data-tope-excepcion]');
      if (!caja) { toast.message('Tope de horas', { description: 'La excepción de tope la carga un usuario con permiso de edición en Eventuales.' }); return; }
      caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
      caja.querySelector<HTMLInputElement>('input')?.focus();
    }
  };

  const verMarco = async (empresaId: string, modo: 'ver' | 'descargar') => {
    try {
      await abrirPdfCallable(modo, () => llamar('gestionarMarcoEventual', { accion: 'marcoPdf', cuil: ficha.id, empresaId }) as Promise<{ pdfBase64?: string | null; link?: string | null; nombre?: string }>);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir el marco.');
    }
  };

  const generarPdf = async (empresaId: string) => {
    try {
      const res = await llamar('gestionarMarcoEventual', { accion: 'generar', cuil: ficha.id, empresaId, fecha: firmaFecha });
      const bin = atob(String(res.pdfBase64 || ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Marco-${nombreEmpresa(empresaId)}.pdf`; a.click();
      toast.success('PDF del marco listo para imprimir.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el PDF.');
    }
  };

  const subirMarco = async () => {
    if (!archivoMarco || !empresaMarcoActual) return;
    try {
      await llamar('gestionarMarcoEventual', {
        accion: 'firmar', cuil: ficha.id, empresaId: empresaMarcoActual, fechaFirma: firmaFecha,
        vigenciaDias: Number(vigenciaDias) || VIGENCIA_MARCO_DEFAULT, pdfBase64: await base64De(archivoMarco),
      });
      toast.success(`Marco de ${nombreEmpresa(empresaMarcoActual)} cargado.`);
      setArchivoMarco(null);
      recargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir el marco.');
    }
  };

  const subirArca = async (file: File) => {
    try {
      await llamar('gestionarMarcoEventual', { accion: 'subir', tipo: 'ARCA', cuil: ficha.id, empresaId: empresaMarcoActual || empresaActivaId, fecha: hoy(), pdfBase64: await base64De(file) });
      toast.success('Constancia ARCA cargada.');
      recargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo subir la constancia.');
    }
  };

  const confirmarBaja = async () => {
    if (!baja.motivo.trim()) { toast.error('Escribí el motivo de la baja.'); return; }
    await onBaja(baja.motivo, baja.fecha);
    setBajaAbierta(false);
    setBaja({ motivo: '', fecha: hoy() });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-4">
        {onVolver && <button type="button" onClick={onVolver} className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600" aria-label="Volver a la lista"><ArrowLeft size={16} /></button>}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-base font-black text-white">{iniciales(ficha.nombre)}</div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-black text-slate-800">{ficha.nombre}</h2>
          <p className="text-xs text-slate-500">
            CUIL {ficha.id}{ficha.dni ? ` · DNI ${ficha.dni}` : ''}
            {textoLegajo(ficha.legajoPlanilla) ? ` · ${textoLegajo(ficha.legajoPlanilla)}` : ''}
            {ficha.primerIngreso ? ` · 1º ingreso ${fmtFechaAr(ficha.primerIngreso)}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${noDisponible ? TONO.malo : TONO.ok}`}>{textoDisponibilidad(ficha.disponibilidad)}</span>
            {ficha.uid && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">Con acceso a la app</span>}
            {ficha.riesgoEncadenamiento && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">Encadenamiento: {ficha.riesgoEncadenamiento}</span>}
            {horasMes && (
              <span data-horas-mes title={horasMes.excepcion ? `Excepción: ${horasMes.motivo || ''}` : 'Tope de la empresa'} className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${horasMes.aviso ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                {horasMes.texto}{horasMes.excepcion ? ' · excepción' : ''}
              </span>
            )}
            {horasMes?.chip && (
              <span data-chip-tope={horasMes.alcanzado ? 'alcanzado' : 'cerca'} title="No se ofrece en Planificación, eventos ni cobertura hasta el próximo período" className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${horasMes.alcanzado ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
                {horasMes.chip}
              </span>
            )}
            {etiquetasPrueba.map((t) => (
              <span key={t} data-pruebas="sin-marco" title="Switch de pruebas: se lo puede convocar sin exigir ese requisito." className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600"><FlaskConical size={10} /> {t}</span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {puede('update') && <TextBtn label="Editar ficha" onClick={onEditar}><Pencil size={14} /></TextBtn>}
          {puede('update') && !noDisponible && !ficha.uid && <TextBtn label="Crear acceso a la app" title={ficha.mail ? 'Le llega un link de 48 h al mail para crear su contraseña' : 'Falta el mail para crear el acceso'} onClick={onAcceso} tono="primario" disabled={!ficha.mail}><KeyRound size={14} /></TextBtn>}
          {puede('update') && !noDisponible && !!ficha.uid && <TextBtn label="Reenviar acceso" title="Vuelve a mandar el link de 48 h al mail" onClick={onAcceso} disabled={!ficha.mail}><KeyRound size={14} /></TextBtn>}
          {puede('update') && noDisponible && <TextBtn label="Reactivar en la bolsa" onClick={onReactivar} tono="ok"><RotateCcw size={14} /></TextBtn>}
          {puede('delete') && !noDisponible && <TextBtn label="Dar de baja" title="Sale de la bolsa (queda como no disponible)" onClick={() => setBajaAbierta((v) => !v)} tono="peligro"><UserX size={14} /></TextBtn>}
        </div>
        {bajaAbierta && (
          <div className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-rose-100 bg-rose-50/60 p-3">
            <label className="flex-1 text-[10px] font-black uppercase text-rose-700">Motivo
              <input value={baja.motivo} onChange={(e) => setBaja({ ...baja, motivo: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-1 text-sm font-normal normal-case" placeholder="Por qué sale de la bolsa" />
            </label>
            <label className="text-[10px] font-black uppercase text-rose-700">Fecha
              <input type="date" value={baja.fecha} onChange={(e) => setBaja({ ...baja, fecha: e.target.value })} className="mt-1 block rounded-xl border border-slate-200 px-2 py-1 text-sm font-normal" />
            </label>
            <button type="button" onClick={confirmarBaja} className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white">Confirmar baja</button>
            <button type="button" onClick={() => setBajaAbierta(false)} className="rounded-xl px-3 py-1.5 text-xs font-bold text-slate-500">Cancelar</button>
          </div>
        )}
      </header>

      {onGuardarTope && puede('update') && (
        <div className="mx-4 mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3" data-tope-excepcion>
          <p className="w-full text-[10px] font-black uppercase tracking-wider text-slate-400">Excepción de tope en esta empresa{horasMes?.topeEmpresa ? ` (la empresa tiene ${horasMes.topeEmpresa} h)` : ''}</p>
          <label className="text-[10px] font-black uppercase text-slate-500">Horas
            <input value={topeEx} onChange={(e) => setTopeEx(e.target.value)} inputMode="decimal" placeholder={horasMes?.excepcion ? String(horasMes.tope) : '50'} className="mt-1 block w-24 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold normal-case text-slate-800" />
          </label>
          <label className="min-w-[180px] flex-1 text-[10px] font-black uppercase text-slate-500">Motivo
            <input value={motivoEx} onChange={(e) => setMotivoEx(e.target.value)} placeholder="Por qué esta persona tiene otro tope" className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold normal-case text-slate-800" />
          </label>
          <button
            type="button"
            disabled={guardandoTope}
            onClick={() => {
              const horas = Number(String(topeEx).replace(',', '.'));
              if (!Number.isFinite(horas) || horas <= 0) { toast.error('Poné las horas de la excepción.'); return; }
              setGuardandoTope(true);
              void onGuardarTope(horas, motivoEx).finally(() => setGuardandoTope(false));
            }}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >{guardandoTope ? 'Guardando…' : 'Guardar excepción'}</button>
          {horasMes?.excepcion && (
            <button type="button" disabled={guardandoTope} onClick={() => { setGuardandoTope(true); void onGuardarTope(null, '').finally(() => setGuardandoTope(false)); }} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
              Quitar excepción
            </button>
          )}
        </div>
      )}

      {checklist && checklist.length > 0 && !noDisponible && (
        <div className="px-4 pt-4">
          <ChecklistEventual pasos={checklist} puedeEditar={puede('update')} ocupado={guardandoEmpresa ? 'EMPRESA' : ''} onAccion={resolverPaso} />
        </div>
      )}

      <div className="px-4 pt-3">
        <TabBar
          compact
          persist={false}
          tabs={[
            { id: 'DATOS', label: 'Datos', icon: User },
            { id: 'EMPRESAS', label: 'Empresas y marco', icon: Building2, count: habilitadas.length },
            { id: 'DOCUMENTOS', label: 'Documentos', icon: FolderOpen, count: documentos.length },
            { id: 'CONTRATOS', label: 'Contratos', icon: FileText, count: contratos.length },
            { id: 'ARCA', label: 'ARCA', icon: Landmark, count: arca.length + (ficha.arcaHistorial?.length || 0) },
            { id: 'HISTORIAL', label: 'Historial', icon: History },
          ]}
          active={solapa}
          onChange={(id) => setSolapa(id as Solapa)}
        />
      </div>

      <div className="p-4">
        {solapa === 'DATOS' && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Dato icon={Mail} label="Mail" valor={ficha.mail} falta={!ficha.mail} />
            <Dato icon={Phone} label="Teléfono" valor={ficha.telefono} falta={!ficha.telefono} />
            <Dato icon={Home} label="Domicilio" valor={[ficha.domicilio, ficha.localidad].filter(Boolean).join(' · ')} falta={!ficha.domicilio} />
            <Dato label="Nacimiento" valor={fmtFechaAr(ficha.fechaNacimiento)} />
            <Dato label="Género" valor={GENERO_LABEL[(ficha.genero || '') as keyof typeof GENERO_LABEL] || 'Sin especificar'} falta={!ficha.genero} />
            <Dato label="Obra social" valor={textoObraSocial(ficha.obraSocialRnos, RNOS_DEFAULT_FICHA)} falta={!!rnos?.pendiente} />
            <Dato label="Habilitación 9236" valor={[ficha.habilitacionNumero, ficha.habilitacionVencimiento ? `vence ${fmtFechaAr(ficha.habilitacionVencimiento)}` : ''].filter(Boolean).join(' · ')} />
            <Dato label="Credencial" valor={ficha.credencialVencimiento ? `vence ${fmtFechaAr(ficha.credencialVencimiento)}` : ''} falta={!!ficha.credencialVencimiento && ficha.credencialVencimiento < hoy()} />
            <Dato label="Apto psicofísico" valor={[ficha.aptoEstado, ficha.aptoVencimiento ? `vence ${fmtFechaAr(ficha.aptoVencimiento)}` : ''].filter(Boolean).join(' · ')} falta={!!ficha.aptoVencimiento && ficha.aptoVencimiento < hoy()} />
            {ficha.observaciones && <div className="sm:col-span-2 lg:col-span-3"><Dato label="Observaciones" valor={ficha.observaciones} /></div>}
            {rnos?.sugerido && rnos.sugerencia && (
              <p className="sm:col-span-2 lg:col-span-3 text-xs text-slate-600">En {nombreEmpresa(rnos.empresaId || '')} figura con obra social {rnos.sugerencia}. Podés cargarla desde Editar.</p>
            )}
          </div>
        )}

        {solapa === 'EMPRESAS' && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Empresas habilitadas</p>
              <div className="flex flex-wrap gap-2">
                {empresas.map((e) => {
                  const on = habilitadas.includes(e.id);
                  return (
                    <button key={e.id} type="button" disabled={!puede('update') || guardandoEmpresa === e.id} onClick={() => toggleEmpresa(e.id, !on)}
                      title={on ? `Quitar de ${e.nombre}` : `Habilitar en ${e.nombre}`}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-60 ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                      {on ? <Check size={12} /> : <Building2 size={12} />} {e.nombre}
                    </button>
                  );
                })}
                {empresas.length === 0 && <p className="text-xs text-slate-400">Cargando empresas…</p>}
              </div>
              {habilitadas.length === 0 && <p className="mt-2 text-xs font-bold text-amber-700">{ficha.exigirMarco ? 'Sin empresa habilitada: no se lo puede convocar.' : 'Sin empresa habilitada: igual se lo puede convocar (pruebas, sin exigir marco).'}</p>}
            </div>

            <div data-switches-pruebas>
              <p className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400"><FlaskConical size={11} /> Modo pruebas (solo SuperAdmin o RRHH con permiso)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SwitchPrueba
                  campo="exigirMarco"
                  label="Exigir contrato marco y habilitación"
                  ayuda="En OFF se lo puede convocar y puede aceptar sin marco vigente ni empresa habilitada, y no se bloquea por anexo."
                  on={ficha.exigirMarco}
                  disabled={!puede('update')}
                  busy={guardandoSwitch === 'exigirMarco'}
                  onChange={(v) => void cambiarSwitch('exigirMarco', v)}
                />
                <SwitchPrueba
                  campo="exigirAltaArca"
                  label="Exigir alta ARCA para fichar"
                  ayuda="En OFF ficha aunque el alta AT no esté confirmada (sin número de transacción)."
                  on={ficha.exigirAltaArca}
                  disabled={!puede('update')}
                  busy={guardandoSwitch === 'exigirAltaArca'}
                  onChange={(v) => void cambiarSwitch('exigirAltaArca', v)}
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Contrato marco (papel, una vez por empresa)</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {habilitadas.map((emp) => {
                  const m = marcos[emp];
                  const vista = textoEstadoMarco(m?.estado, m?.vencimiento);
                  const firmado = m?.estado === 'MARCO_VIGENTE' || m?.estado === 'VENCIDO';
                  return (
                    <li key={emp} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1 font-bold text-slate-700">{nombreEmpresa(emp)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${TONO[vista.tono] || TONO.pendiente}`}>{vista.texto}</span>
                      {m?.avisar && <span className="text-[10px] font-bold text-amber-700">vence en menos de 30 días</span>}
                      {puedeLeer && firmado && <TextBtn label="Ver marco" title={`Abre el contrato marco firmado de ${nombreEmpresa(emp)}`} onClick={() => void verMarco(emp, 'ver')}><Eye size={13} /></TextBtn>}
                      {puedeLeer && firmado && <TextBtn label="Descargar" title={`Descarga el PDF del contrato marco firmado de ${nombreEmpresa(emp)}`} onClick={() => void verMarco(emp, 'descargar')}><Download size={13} /></TextBtn>}
                      {puede('update') && <TextBtn label="PDF para imprimir" title={`Generar el PDF del contrato marco de ${nombreEmpresa(emp)} para firmar en papel`} onClick={() => generarPdf(emp)}><Download size={13} /></TextBtn>}
                    </li>
                  );
                })}
                {habilitadas.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">Habilitá una empresa para ver su marco.</li>}
              </ul>
            </div>

            {puede('update') && habilitadas.length > 0 && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400"><Upload size={11} /> Subir contrato marco firmado</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[10px] font-black uppercase text-slate-500">Empresa
                    <select value={empresaMarcoActual} onChange={(e) => setEmpresaMarco(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold normal-case text-slate-800">
                      {habilitadas.map((id) => <option key={id} value={id}>{nombreEmpresa(id)}</option>)}
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-500">Fecha de firma
                    <input type="date" value={firmaFecha} onChange={(e) => setFirmaFecha(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800" />
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-500">Vigencia
                    <select value={vigenciaDias} onChange={(e) => setVigenciaDias(e.target.value)} className="mt-1 block rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold normal-case text-slate-800">
                      {opcionesVigenciaMarco().map((op) => <option key={op.dias} value={String(op.dias)}>{op.label}</option>)}
                    </select>
                  </label>
                  <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    {archivoMarco ? archivoMarco.name : 'Elegir archivo (PDF o foto)'}
                    <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { setArchivoMarco(e.target.files?.[0] || null); e.target.value = ''; }} />
                  </label>
                  <button type="button" onClick={subirMarco} disabled={!archivoMarco || !empresaMarcoActual} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm disabled:opacity-50">
                    <Upload size={13} /> Subir contrato marco
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {solapa === 'DOCUMENTOS' && (
          <div className="space-y-3">
            {documentos.length === 0 && <p className="text-xs text-slate-400">Todavía no hay archivos en Drive.</p>}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
              {documentos.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <FileText size={14} className="text-slate-400" />
                  <span className="flex-1 truncate text-slate-700">{d.nombre || humanizar(d.tipo)}</span>
                  {d.drivePendiente && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">Pendiente de Drive</span>}
                  {d.link && <a href={d.link} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-700 underline">Abrir</a>}
                </li>
              ))}
            </ul>
            {puede('update') && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={async () => { await llamar('gestionarMarcoEventual', { accion: 'reintentar', cuil: ficha.id }); toast.success('Se reintenta la subida a Drive.'); recargar(); }} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"><RefreshCw size={13} /> Reintentar pendientes</button>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-white"><Upload size={13} /> Subir constancia ARCA
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirArca(f); }} />
                </label>
              </div>
            )}
          </div>
        )}

        {solapa === 'CONTRATOS' && (
          <ContratosEventual
            cuil={ficha.id}
            exigirMarco={ficha.exigirMarco}
            contratos={contratos}
            arca={arca}
            nombreEmpresa={nombreEmpresa}
            puedeLeer={puedeLeer}
            puedeEditar={puede('update')}
            llamar={llamar}
            recargar={recargar}
          />
        )}

        {solapa === 'ARCA' && (
          <div className="space-y-2">
            {(ficha.arcaHistorial || []).length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {(ficha.arcaHistorial || []).map((h, i) => (
                  <li key={`${h.fecha || ''}_${h.estado || ''}_${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-slate-600">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${h.estado === 'BAJA' ? TONO.malo : TONO.ok}`}>{h.estado === 'BAJA' ? 'Baja' : h.estado === 'ALTA' ? 'Alta' : humanizar(h.estado)}</span>
                    <span className="font-bold text-slate-800">{fmtFechaAr(h.fecha) || '—'}</span>
                    <span>{h.origen === 'IMPORT_PLANILLA' ? 'Planilla' : humanizar(h.origen)}</span>
                  </li>
                ))}
              </ul>
            )}
            {arca.length === 0 && (ficha.arcaHistorial || []).length === 0 && <p className="text-xs text-slate-400">Sin altas ni bajas.</p>}
            {arca.map((a) => (
              <p key={a.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="font-bold text-slate-800">{humanizar(a.tipo)}</span> · {humanizar(a.estado)} · {fmtFechaAr(a.fechaAlta) || '—'} {a.nroTransaccion ? `· Nº ${a.nroTransaccion}` : ''}{a.nroVerificador ? ` · Verif. ${a.nroVerificador}` : ''}{a.codigoControl ? ` · Ctrl ${a.codigoControl}` : ''}{a.constanciaUrl ? ' · constancia' : ''}
                {(a.advertencias || []).includes('RELACION_ACTIVA_EMPLEADOR') && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"><ShieldAlert size={11} /> ya tiene relación activa con este empleador; ARCA puede rechazar el alta eventual</span>}
                {(a.advertencias || []).includes('RETRIBUCION_PENDIENTE') && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800"><ShieldAlert size={11} /> Retribución pendiente: no se envía hasta aprobar la escala</span>}
              </p>
            ))}
          </div>
        )}

        {solapa === 'HISTORIAL' && (
          <ul className="space-y-1">
            {historial.length === 0 && <li className="text-xs text-slate-400">Sin movimientos.</li>}
            {historial.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="w-20 shrink-0 text-slate-400">{h.at ? fmtFechaAr(h.at) : ''}</span>
                <span className="font-bold text-slate-800">{HISTORIAL_LABEL[h.action || ''] || humanizar(h.action)}</span>
                <span className="truncate">{h.details}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

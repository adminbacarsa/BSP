/** @jsxRuntime classic */
/** @jsx React.createElement */
/**
 * Capturas 1440x900 del modal de cobertura de Planificación (escritorio, v2) con las piezas reales
 * (`components/planificacion/CoberturaModalV2`) y el CSS del export estático.
 * Antes: cd apps/web2 && npm run build   (deja apps/web2/out/_next/static/css)
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/capturar-cobertura-modal.tsx
 *
 * Usa el Chromium de la caché de Playwright (%LOCALAPPDATA%\ms-playwright) o CHROME_BIN.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AvisoCobertura,
  CoberturaBarra,
  CoberturaDias,
  CoberturaFranja,
  CoberturaPie,
  CoberturaTabs,
  ConsultaDiaBox,
  FilaCandidatoNomina,
  ModoCoberturaSwitch,
  NoDisponiblesNomina,
  type DiaFila,
} from '../apps/web2/src/components/planificacion/CoberturaModalV2';
import { BarraPreguntar } from '../apps/web2/src/components/eventuales/EventualesCandidatosUx';
import {
  estadoDiaCobertura,
  resumenConsultaDia,
  textoAccionPrincipal,
  textoBarraAsignar,
  textoBotonAsignar,
  textoCubrir,
  textoRangoDias,
} from '../apps/web2/src/lib/planificacion/coberturaEventualesUx';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'apps/web2/package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const outDir = join(root, 'docs/capturas-cobertura');
mkdirSync(outDir, { recursive: true });
const cssDir = join(root, 'apps/web2/out/_next/static/css');
if (!existsSync(cssDir)) throw new Error('Falta el CSS del export. Corré npm run build en apps/web2.');
const css = readdirSync(cssDir).filter((n) => n.endsWith('.css')).map((n) => readFileSync(join(cssDir, n), 'utf8')).join('\n');

function chromium(): string {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(base)) throw new Error('No encuentro Chromium: definí CHROME_BIN.');
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    for (const exe of ['chrome-win/headless_shell.exe', 'chrome-win/chrome.exe', 'chrome-win64/headless_shell.exe', 'chrome-win64/chrome.exe']) {
      const p = join(base, d, exe);
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No encuentro Chromium en ms-playwright: definí CHROME_BIN.');
}

type Cand = { id: string; nombre: string; meta: string; tag: string; tono: 'violet' | 'amber' | 'sky' | 'emerald'; nota?: string | null };
const candidatos: Cand[] = [
  { id: 'e1', nombre: 'GUERRERO, Marcos', meta: '136 h este mes · 2 km', tag: 'Retén', tono: 'amber' },
  { id: 'e2', nombre: 'FERRERO, Juan', meta: '142 h este mes · 3 km', tag: 'Libre', tono: 'emerald' },
  { id: 'e3', nombre: 'BOSIO, Ana', meta: '148 h este mes · 6 km', tag: 'Libre', tono: 'emerald' },
  { id: 'e4', nombre: 'FONTANA, Luis', meta: '160 h este mes · 4 km', tag: 'Franco · FT', tono: 'violet', nota: 'se consulta como FT' },
  { id: 'e5', nombre: 'LOPEZ, Raúl', meta: '152 h este mes · 11 km', tag: 'Franco · FT', tono: 'violet', nota: 'se consulta como FT' },
];
const noDisponibles = [
  { id: 'n1', nombre: 'FARIAS, Diego', motivo: 'En servicio ese día' },
  { id: 'n2', nombre: 'VENENCIA, Sol', motivo: 'En servicio ese día' },
  { id: 'n3', nombre: 'FANTINI, Mario', motivo: 'De licencia ese día' },
];
const JORNADA = { fecha: '2026-10-06', code: 'M', horaInicio: '10:45', horaFin: '12:00', horas: 1.25 };
const cubrir = textoCubrir({ code: 'M', positionName: 'Puesto 1', scheduleLabel: '10:45–12:00', hours: 1.25 });

function Modal(p: { franja: React.ReactNode; dias: React.ReactNode; derecha: React.ReactNode; accion: string }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]">
      <div className="flex w-full max-w-[1100px] max-h-[min(92vh,860px)] flex-col overflow-hidden rounded-2xl border-l-4 border-l-rose-500 bg-white shadow-2xl">
        {p.franja}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="flex shrink-0 flex-col border-slate-200 bg-slate-50/70 lg:w-[300px] lg:border-r">{p.dias}</aside>
          <section className="flex min-h-0 flex-1 flex-col p-4">{p.derecha}</section>
        </div>
        <CoberturaPie accion={p.accion} onAccion={() => {}} onCerrar={() => {}} />
      </div>
    </div>
  );
}

function Nomina(p: { modo: 'preguntar' | 'asignar'; marcados: string[]; seleccionado: string | null; dia: string }) {
  const sel = candidatos.find((c) => c.id === p.seleccionado) || null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CoberturaTabs tab="nomina" onTab={() => {}} eventuales split />
        <ModoCoberturaSwitch modo={p.modo} onModo={() => {}} puedePreguntar />
      </div>
      <div className="relative">
        <input className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-bold outline-none" placeholder="Buscar por nombre o legajo…" readOnly />
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {candidatos.map((c) => (
          <FilaCandidatoNomina
            key={c.id}
            c={{ ...c, nota: p.modo === 'asignar' && c.tono === 'violet' ? 'franco trabajado · pide PIN' : c.nota }}
            modo={p.modo}
            marcado={p.marcados.includes(c.id)}
            seleccionado={p.seleccionado === c.id}
            onToggle={() => {}}
            onElegir={() => {}}
          />
        ))}
        <NoDisponiblesNomina rows={noDisponibles} />
      </div>
      {p.modo === 'preguntar' ? (
        <BarraPreguntar n={p.marcados.length} jornadas={[JORNADA]} espera={30} onEspera={() => {}} onEnviar={() => {}} />
      ) : (
        <CoberturaBarra
          texto={textoBarraAsignar(sel?.nombre, p.dia, 'M', '10:45–12:00')}
          detalle={sel ? 'Puesto 1 · 1,25 h' : null}
          boton={textoBotonAsignar(sel?.nombre)}
          disabled={!sel}
          onClick={() => {}}
        />
      )}
    </>
  );
}

const franja = (rango: string, dia: string) => (
  <CoberturaFranja titular="BAEZ, Carlos" motivo="Ausencia médica" codigo="E" rango={rango} diaLabel={dia} cubrir={cubrir} bandas={[{ value: 'M__Puesto 1', label: cubrir }]} bandaValue="M__Puesto 1" onBanda={() => {}} onClose={() => {}} />
);
const fila = (date: string, label: string, estado: DiaFila['estado'], seleccionado = false, activo = true): DiaFila => ({
  date, label, activo, seleccionado, estado, puedeQuitar: estado.tipo === 'suplente' || estado.tipo === 'split',
});
const SIN = { tipo: 'sin_cubrir', tono: 'rose', texto: 'Sin cubrir' } as const;

const abierta = {
  status: 'ABIERTA',
  venceAtMs: Date.UTC(2026, 9, 6, 14, 15),
  jornadas: [{ fecha: '2026-10-06' }],
  respuestas: [
    { nombre: 'FERRERO, Juan', estado: 'PENDIENTE', hora: null },
    { nombre: 'BOSIO, Ana', estado: 'PENDIENTE', hora: null },
    { nombre: 'FONTANA, Luis', estado: 'NO', hora: '10:20' },
  ],
};
const esperando = estadoDiaCobertura({ activo: true, cobertura: { mode: 'none' }, consulta: abierta });

const estados: { nombre: string; jsx: React.ReactNode }[] = [
  {
    nombre: '01-un-dia-sin-cubrir',
    jsx: (
      <Modal
        franja={franja(textoRangoDias(['2026-10-06']), '06/10')}
        dias={<CoberturaDias dias={[fila('2026-10-06', 'mar 06/10', SIN, true)]} onSeleccionar={() => {}} onMarcar={() => {}} onTodos={() => {}} onNinguno={() => {}} onQuitar={() => {}} aplicarMarcados={null} completar={null} />}
        derecha={<Nomina modo="preguntar" marcados={['e1', 'e2']} seleccionado={null} dia="2026-10-06" />}
        accion={textoAccionPrincipal(false)}
      />
    ),
  },
  {
    nombre: '02-cinco-dias-dos-cubiertos',
    jsx: (
      <Modal
        franja={franja(textoRangoDias(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']), '08/10')}
        dias={(
          <CoberturaDias
            dias={[
              fila('2026-10-06', 'mar 06/10', { tipo: 'suplente', tono: 'emerald', texto: 'Suplente · GUERRERO' }),
              fila('2026-10-07', 'mié 07/10', { tipo: 'split', tono: 'violet', texto: 'Ext+Adel · FARIAS / VENENCIA' }),
              fila('2026-10-08', 'jue 08/10', SIN, true),
              fila('2026-10-09', 'vie 09/10', SIN),
              fila('2026-10-10', 'sáb 10/10', SIN),
            ]}
            onSeleccionar={() => {}} onMarcar={() => {}} onTodos={() => {}} onNinguno={() => {}} onQuitar={() => {}}
            aplicarMarcados={{ n: 5, habilitado: true, onClick: () => {} }}
            completar={{ texto: 'Completar 3 día(s) sin cobertura con la de 06/10', onClick: () => {} }}
          />
        )}
        derecha={<Nomina modo="asignar" marcados={[]} seleccionado="e2" dia="2026-10-08" />}
        accion={textoAccionPrincipal(true)}
      />
    ),
  },
  {
    nombre: '03-consulta-esperando',
    jsx: (
      <Modal
        franja={franja(textoRangoDias(['2026-10-06']), '06/10')}
        dias={<CoberturaDias dias={[fila('2026-10-06', 'mar 06/10', esperando, true)]} onSeleccionar={() => {}} onMarcar={() => {}} onTodos={() => {}} onNinguno={() => {}} onQuitar={() => {}} aplicarMarcados={null} completar={null} />}
        derecha={(
          <>
            <ConsultaDiaBox estado={esperando} resumen={resumenConsultaDia(abierta)} abierta onCancelar={() => {}} />
            <p className="text-[10px] font-bold text-slate-500">Para cubrir este día de otra forma, cancelá la consulta primero.</p>
            <AvisoCobertura>Podés cerrar: la celda de la grilla muestra «Consulta enviada · vence 11:15» y la pastilla «Consultas en curso» sigue el resultado.</AvisoCobertura>
          </>
        )}
        accion={textoAccionPrincipal(true)}
      />
    ),
  },
];

const exe = chromium();
for (const e of estados) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0;background:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif}</style></head><body style="width:1440px;height:900px">${renderToStaticMarkup(e.jsx)}</body></html>`;
  const tmp = join(outDir, `.${e.nombre}.html`);
  writeFileSync(tmp, html);
  const png = join(outDir, `${e.nombre}.png`);
  execFileSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1440,900', `--screenshot=${png}`, pathToFileURL(tmp).href], { stdio: 'ignore' });
  console.log('OK', png);
}
for (const e of estados) {
  try { require('node:fs').rmSync(join(outDir, `.${e.nombre}.html`)); } catch { /* ignore */ }
}

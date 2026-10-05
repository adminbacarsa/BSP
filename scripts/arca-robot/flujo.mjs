/**
 * Reglas puras del robot ARCA. La clave fiscal no se loguea ni se arma aca.
 */
import path from 'node:path';

export function esSimulacion(env = process.env) {
  const v = String(env.ARCA_SIMULACION || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'si' || v === 'sí';
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : '1';
  }
  return out;
}

export function claveDeCuit(claves, cuit) {
  const limpio = String(cuit || '').replace(/\D/g, '');
  if (!limpio || !claves || typeof claves !== 'object') return '';
  return String(claves[limpio] || '');
}

/** Numeros de transaccion que muestra el acuse de Simplificacion Registral. */
export function extraerNros(texto) {
  const found = [];
  const re = /transacci[oó]n(?:es)?[^0-9]{0,40}([0-9]{4,})/gi;
  const src = String(texto || '');
  let m = re.exec(src);
  while (m) {
    if (!found.includes(m[1])) found.push(m[1]);
    m = re.exec(src);
  }
  return found;
}

export function bodyResultado({
  loteId, envioId, estado, nroTransaccion, constanciaUrl, error, acuse, fallosRobot, arcaCodigoNovedad,
}) {
  const body = { estado };
  if (loteId) body.loteId = String(loteId);
  if (envioId) body.envioId = String(envioId);
  if (nroTransaccion) body.nroTransaccion = String(nroTransaccion);
  if (constanciaUrl) body.constanciaUrl = String(constanciaUrl).slice(0, 500);
  if (error) body.error = String(error).slice(0, 500);
  if (acuse) body.acuse = String(acuse).slice(0, 120);
  if (fallosRobot) body.fallosRobot = Number(fallosRobot);
  if (arcaCodigoNovedad) body.arcaCodigoNovedad = String(arcaCodigoNovedad);
  return body;
}

export function nroSimulado(loteId) {
  const limpio = String(loteId || 'LOTE').replace(/[^a-zA-Z0-9]/g, '').slice(-12) || 'LOTE';
  return `SIM-${limpio}`;
}

/** La clave no puede vivir dentro del repo. */
export function clavesPathSeguro(clavesPath, repoRoot) {
  const p = String(clavesPath || '').trim();
  if (!p) return '';
  if (repoRoot) {
    const file = path.resolve(p);
    const root = path.resolve(String(repoRoot));
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      throw new Error('ARCA_CLAVES_PATH_DENTRO_DEL_REPO');
    }
  }
  return p;
}

export function soloDigitosCuit(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function formatearCuit(cuit) {
  const d = soloDigitosCuit(cuit);
  if (d.length !== 11) return d;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** Mismo CUIT: entra directo. Distinto: hay que elegir la empresa representada. */
export function planAcceso(acceso) {
  const cuitLogin = soloDigitosCuit(acceso && acceso.cuitLogin);
  const cuitRepresentado = soloDigitosCuit((acceso && acceso.cuitRepresentado) || cuitLogin);
  return {
    cuitLogin,
    cuitRepresentado,
    elegirRepresentado: Boolean(cuitLogin && cuitRepresentado && cuitLogin !== cuitRepresentado),
  };
}

export function sanitizarTexto(texto, secreto) {
  const s = String(secreto || '');
  const base = String(texto || '');
  if (!s) return base;
  return base.split(s).join('***');
}

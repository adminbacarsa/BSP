/**
 * Marcos en lote: QR de la hoja de firmas, CUIL en el nombre del archivo y agrupado de hojas escaneadas.
 * Sin dependencias de Node: lo usan el front (RRHH → Eventuales) y el servidor (subirMarcosLote).
 */
import { MARCO_VERSION } from './marcoAnexoConst.mjs';
import { marcoDeBolsa } from './marcoTexto.mjs';

export const QR_MARCO_TIPO = 'COSP_MARCO';
export const MOTIVOS_SIN_ASIGNAR = {
  SIN_QR: 'Sin QR legible y sin CUIL en el nombre del archivo',
  OTRA_EMPRESA: 'El QR es de otra empresa',
  NO_EN_BOLSA: 'El CUIL no está en la bolsa',
  SIN_IMAGEN: 'La hoja no tiene imagen que se pueda leer',
};

export function payloadQrMarco({ bolsaCuil, empresaId, marcoVersion }) {
  return JSON.stringify({
    t: QR_MARCO_TIPO,
    bolsaCuil: String(bolsaCuil || '').replace(/\D/g, ''),
    empresaId: String(empresaId || ''),
    marcoVersion: Number(marcoVersion) > 0 ? Number(marcoVersion) : MARCO_VERSION,
  });
}

/** Devuelve { bolsaCuil, empresaId, marcoVersion } o null si el texto no es un QR de marco. */
export function parsearQrMarco(texto) {
  if (!texto) return null;
  let data;
  try {
    data = JSON.parse(String(texto));
  } catch {
    return null;
  }
  if (!data || data.t !== QR_MARCO_TIPO) return null;
  const bolsaCuil = String(data.bolsaCuil || '').replace(/\D/g, '');
  if (bolsaCuil.length !== 11) return null;
  return {
    bolsaCuil,
    empresaId: String(data.empresaId || ''),
    marcoVersion: Number(data.marcoVersion) > 0 ? Number(data.marcoVersion) : 1,
  };
}

/** 20-12345678-9, 20123456789 o 20 12345678 9 en el nombre del archivo. */
export function cuilDeNombreArchivo(nombre) {
  const m = String(nombre || '').match(/(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)(?!\d)/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

export function formatearCuil(cuil) {
  const d = String(cuil || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
}

/**
 * Agrupa hojas por persona.
 * Cada hoja: { id, archivo, pagina, qr: texto|null, sinImagen?: boolean }.
 * Una hoja con QR es de esa persona. Las hojas sin QR de la misma carpeta/archivo se pegan
 * a la siguiente hoja con QR (el QR está en la hoja de firmas, la última del ejemplar).
 * Si el archivo no tiene ningún QR, vale el CUIL del nombre del archivo. El resto queda sin asignar.
 * `cuilsEnBolsa` (opcional): Set de CUIL válidos; un QR de alguien fuera de la bolsa queda sin asignar.
 */
export function agruparPaginas({ paginas, empresaId, cuilsEnBolsa }) {
  const porArchivo = new Map();
  for (const p of paginas || []) {
    const key = String(p.archivo || '');
    if (!porArchivo.has(key)) porArchivo.set(key, []);
    porArchivo.get(key).push(p);
  }
  const grupos = new Map();
  const sinAsignar = [];
  const enBolsa = (cuil) => !cuilsEnBolsa || cuilsEnBolsa.has(cuil);
  const sumar = (cuil, hoja, fuente) => {
    if (!grupos.has(cuil)) grupos.set(cuil, { cuil, paginas: [], fuente });
    const g = grupos.get(cuil);
    g.paginas.push(hoja.id);
    if (fuente === 'QR') g.fuente = 'QR';
  };

  for (const [archivo, hojas] of porArchivo) {
    hojas.sort((a, b) => Number(a.pagina) - Number(b.pagina));
    const cuilArchivo = cuilDeNombreArchivo(archivo);
    let pendientes = [];
    let hayQr = false;
    for (const hoja of hojas) {
      const qr = parsearQrMarco(hoja.qr);
      if (!qr) {
        pendientes.push(hoja);
        continue;
      }
      hayQr = true;
      if (empresaId && qr.empresaId && qr.empresaId !== empresaId) {
        for (const h of [...pendientes, hoja]) sinAsignar.push({ id: h.id, archivo, pagina: h.pagina, motivo: 'OTRA_EMPRESA', cuil: qr.bolsaCuil });
        pendientes = [];
        continue;
      }
      if (!enBolsa(qr.bolsaCuil)) {
        for (const h of [...pendientes, hoja]) sinAsignar.push({ id: h.id, archivo, pagina: h.pagina, motivo: 'NO_EN_BOLSA', cuil: qr.bolsaCuil });
        pendientes = [];
        continue;
      }
      for (const h of pendientes) sumar(qr.bolsaCuil, h, 'QR');
      sumar(qr.bolsaCuil, hoja, 'QR');
      pendientes = [];
    }
    if (pendientes.length) {
      if (!hayQr && cuilArchivo && enBolsa(cuilArchivo)) {
        for (const h of pendientes) sumar(cuilArchivo, h, 'ARCHIVO');
      } else {
        for (const h of pendientes) {
          const motivo = h.sinImagen ? 'SIN_IMAGEN' : (!hayQr && cuilArchivo && !enBolsa(cuilArchivo) ? 'NO_EN_BOLSA' : 'SIN_QR');
          sinAsignar.push({ id: h.id, archivo, pagina: h.pagina, motivo, cuil: !hayQr && cuilArchivo ? cuilArchivo : '' });
        }
      }
    }
  }
  const lista = [...grupos.values()];
  return {
    grupos: lista,
    sinAsignar,
    reconocidos: lista.length,
    hojasReconocidas: lista.reduce((n, g) => n + g.paginas.length, 0),
    hojasSinAsignar: sinAsignar.length,
  };
}

/** Asignación manual: la hoja pasa al grupo del CUIL elegido y sale de sinAsignar. */
export function asignarHoja(resultado, hojaId, cuil) {
  const limpio = String(cuil || '').replace(/\D/g, '');
  const hoja = resultado.sinAsignar.find((h) => h.id === hojaId);
  if (!hoja || limpio.length !== 11) return resultado;
  const grupos = resultado.grupos.map((g) => ({ ...g, paginas: [...g.paginas] }));
  const existente = grupos.find((g) => g.cuil === limpio);
  if (existente) existente.paginas.push(hojaId);
  else grupos.push({ cuil: limpio, paginas: [hojaId], fuente: 'MANUAL' });
  const sinAsignar = resultado.sinAsignar.filter((h) => h.id !== hojaId);
  return {
    grupos,
    sinAsignar,
    reconocidos: grupos.length,
    hojasReconocidas: grupos.reduce((n, g) => n + g.paginas.length, 0),
    hojasSinAsignar: sinAsignar.length,
  };
}

export function resumenLote(resultado) {
  const r = resultado || { grupos: [], sinAsignar: [] };
  const personas = r.grupos.length;
  const hojas = r.grupos.reduce((n, g) => n + g.paginas.length, 0);
  const partes = [`${personas} persona${personas === 1 ? '' : 's'} reconocida${personas === 1 ? '' : 's'} (${hojas} hoja${hojas === 1 ? '' : 's'})`];
  if (r.sinAsignar.length) partes.push(`${r.sinAsignar.length} hoja${r.sinAsignar.length === 1 ? '' : 's'} sin asignar`);
  return partes.join(' · ');
}

/** Personas de la bolsa habilitadas en la empresa que hoy no tienen marco vigente. */
export function pendientesDeMarco({ fichas, empresaId, hoy }) {
  return (fichas || []).filter((f) => {
    if (f.status === 'INACTIVE' || f.disponibilidad === 'NO_DISPONIBLE') return false;
    const habilitadas = Array.isArray(f.empresasHabilitadas) ? f.empresasHabilitadas : [];
    if (empresaId && !habilitadas.includes(empresaId)) return false;
    const estado = marcoDeBolsa(f, empresaId, hoy).estado;
    return estado === 'SIN_MARCO' || estado === 'VENCIDO';
  });
}

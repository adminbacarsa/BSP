/**
 * La escala no se aplica sola. El job solo propone, o avisa si no puede leer una tabla.
 * No está enganchado a un scheduler publicado.
 */
export const FUENTES_ESCALA_SUVICO = [
  {
    id: 'suvico',
    url: 'https://www.suvico.org.ar/',
    nota: 'La home nombra la escala vigente. /escala y /escala-salarial responden 404 (29/09/2026).',
  },
  {
    id: 'boletin-cordoba',
    url: 'https://boletinoficial.cba.gov.ar/',
    nota: 'Homologaciones del Ministerio de Trabajo. Sin acta parseable en este paso.',
  },
  {
    id: 'infoleg',
    url: 'https://www.infoleg.gob.ar/',
    nota: 'El CCT 422/05 no publica ahí la paritaria semestral de Córdoba.',
  },
];

const MARCA_TABLA = 'ESCALA_SUVICO_TABLA';

/** Solo acepta una tabla marcada, una categoría por línea: CODIGO|YYYY-MM-DD|basico|label */
export function parsearEscalaSuvico(texto, fuenteUrl = '') {
  const cuerpo = String(texto || '');
  if (!cuerpo.includes(MARCA_TABLA)) return null;
  const filas = [];
  for (const linea of cuerpo.split(/\r?\n/)) {
    const partes = linea.split('|').map((p) => p.trim());
    if (partes.length < 4) continue;
    const [categoria, vigenciaDesde, basicoRaw, categoriaLabel] = partes;
    const basicoMensual = Number(String(basicoRaw).replace(/\./g, '').replace(',', '.'));
    if (!/^[A-Z0-9_]+$/.test(categoria)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaDesde)) continue;
    if (!Number.isFinite(basicoMensual) || basicoMensual <= 0) continue;
    filas.push({ categoria, categoriaLabel, vigenciaDesde, basicoMensual });
  }
  if (!filas.length) return null;
  return { fuenteUrl, filas };
}

export function propuestaDeFila(fila, fuenteUrl) {
  return {
    convenio: 'CCT_422_05',
    categoria: fila.categoria,
    categoriaLabel: fila.categoriaLabel,
    vigenciaDesde: fila.vigenciaDesde,
    basicoMensual: fila.basicoMensual,
    divisorHoras: 200,
    jornadaOrdinariaHoras: 8,
    recargos: {
      nocturnoPct: null,
      extra50Pct: 50,
      extra100Pct: 100,
      sabado13Pct: 100,
      domingoPct: 100,
      feriadoPct: 100,
    },
    presentismo: null,
    adicionales: [],
    status: 'PENDIENTE_APROBACION',
    fuenteUrl,
    fuenteNota: 'Propuesta automática. No rige hasta que SuperAdmin la apruebe.',
  };
}

export function planJobEscalaSuvico(lecturas) {
  const propuestas = [];
  for (const lectura of lecturas || []) {
    const parsed = parsearEscalaSuvico(lectura.cuerpo, lectura.url);
    if (!parsed) continue;
    for (const fila of parsed.filas) propuestas.push(propuestaDeFila(fila, parsed.fuenteUrl));
  }
  if (propuestas.length) return { accion: 'PROPUESTA', propuestas };
  return {
    accion: 'AVISO',
    motivo: 'SIN_FUENTE_PARSEABLE',
    fuentes: FUENTES_ESCALA_SUVICO,
    cargaAsistida: 'SuperAdmin pega la tabla de la paritaria (categoría, vigencia, básico) y queda en PENDIENTE_APROBACION.',
  };
}

export function aprobarEscala(propuesta) {
  if (!propuesta || propuesta.status !== 'PENDIENTE_APROBACION') {
    return { ok: false, codigo: 'NO_ES_PROPUESTA' };
  }
  return { ok: true, escala: { ...propuesta, status: 'ACTIVE', fuenteNota: 'Aprobada por SuperAdmin.' } };
}

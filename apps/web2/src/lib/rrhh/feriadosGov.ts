export type FeriadoTipo = 'Nacional' | 'Puente' | 'Optativo' | 'Gremial';

export interface FeriadoOficial {
  date: string;
  name: string;
  type: FeriadoTipo;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ley 27.399, todo tipo trasladable: lunes queda; martes o miércoles → lunes anterior;
 * jueves o viernes → lunes siguiente; sábado o domingo queda. Una fecha ya en lunes no se mueve.
 */
export function trasladarFeriado(iso: string): string {
  if (!FECHA.test(iso)) return iso;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return iso;
  const dow = utc.getUTCDay();
  const delta = dow === 2 ? -1 : dow === 3 ? -2 : dow === 4 ? 4 : dow === 5 ? 3 : 0;
  if (delta === 0) return iso;
  utc.setUTCDate(utc.getUTCDate() + delta);
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${mm}-${dd}`;
}

function nombreConFechaDeLey(name: string, ley: string, observada: string): string {
  if (observada === ley) return name;
  const marca = `(${Number(ley.slice(8, 10))}/${Number(ley.slice(5, 7))})`;
  if (name.includes(marca)) return name;
  return `${name} ${marca}`;
}

function aplicarTraslado(date: string, name: string, tipo: unknown): { date: string; name: string } {
  if (String(tipo ?? '').trim().toLowerCase() !== 'trasladable') return { date, name };
  const observada = trasladarFeriado(date);
  return { date: observada, name: nombreConFechaDeLey(name, date, observada) };
}

export function mapTipoFeriado(tipo: unknown): FeriadoTipo {
  const t = String(tipo ?? '').trim().toLowerCase();
  if (!t || t === 'inamovible' || t === 'trasladable' || t === 'nacional') return 'Nacional';
  if (t === 'puente' || t.includes('no laborable') || t.includes('nolaborable')) return 'Puente';
  if (t === 'optativo' || t === 'opcional') return 'Optativo';
  if (t === 'gremial') return 'Gremial';
  return 'Nacional';
}

function dedupePorFecha(rows: FeriadoOficial[]): FeriadoOficial[] {
  const seen = new Set<string>();
  const out: FeriadoOficial[] = [];
  for (const row of rows) {
    if (seen.has(row.date)) continue;
    seen.add(row.date);
    out.push(row);
  }
  return out;
}

/** api.argentinadatos.com: { fecha, nombre, tipo }. */
export function mapArgentinaDatos(data: unknown): FeriadoOficial[] {
  if (!Array.isArray(data)) return [];
  const rows: FeriadoOficial[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const cruda = String(o.fecha ?? '').trim().slice(0, 10);
    const nombre = String(o.nombre ?? '').trim();
    if (!FECHA.test(cruda) || !nombre) continue;
    const { date, name } = aplicarTraslado(cruda, nombre, o.tipo);
    rows.push({ date, name, type: mapTipoFeriado(o.tipo) });
  }
  return dedupePorFecha(rows);
}

/** nolaborables.com.ar: { mes, dia, motivo }. El año lo pone quien consulta. */
export function mapNolaborables(data: unknown, year: number): FeriadoOficial[] {
  if (!Array.isArray(data) || !Number.isInteger(year)) return [];
  const rows: FeriadoOficial[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const mes = Number(o.mes);
    const dia = Number(o.dia);
    if (!Number.isInteger(mes) || !Number.isInteger(dia) || mes < 1 || mes > 12 || dia < 1 || dia > 31) continue;
    const nombre = String(o.motivo ?? '').trim();
    if (!nombre) continue;
    const cruda = `${year}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const { date, name } = aplicarTraslado(cruda, nombre, o.tipo);
    rows.push({ date, name, type: mapTipoFeriado(o.tipo) });
  }
  return dedupePorFecha(rows);
}

/**
 * Ya está cargado para esta empresa: el doc es de ella, o es global (sin empresaId, se ve en todas).
 * Un feriado de otra empresa no bloquea el alta.
 */
export function feriadoCuentaParaEmpresa(docEmpresaId: unknown, empresaId: string | undefined): boolean {
  const docEmp = String(docEmpresaId ?? '').trim();
  const emp = String(empresaId ?? '').trim();
  if (!docEmp) return true;
  if (!emp) return false;
  return docEmp === emp;
}

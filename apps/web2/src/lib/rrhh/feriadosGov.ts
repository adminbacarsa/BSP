export type FeriadoTipo = 'Nacional' | 'Puente' | 'Optativo' | 'Gremial';

export interface FeriadoOficial {
  date: string;
  name: string;
  type: FeriadoTipo;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

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
    const date = String(o.fecha ?? '').trim().slice(0, 10);
    const name = String(o.nombre ?? '').trim();
    if (!FECHA.test(date) || !name) continue;
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
    const name = String(o.motivo ?? '').trim();
    if (!name) continue;
    const date = `${year}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
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

import * as XLSX from 'xlsx';

export interface MarcacionExcelRow {
  ccosto: string;
  count: number;
}

export interface ParsedMarcacionRow {
  rowIndex: number;
  dni: string;
  employeeName: string;
  ccosto: string;
  entryAt: Date;
  exitAt: Date;
}

const AR_TZ = 'America/Argentina/Cordoba';

export function parseMarcacionNombre(raw: unknown): { name: string; dni: string } {
  const s = String(raw ?? '');
  const m = s.match(/^(.+?)DNI:(\d+)/i);
  return m ? { name: m[1].trim(), dni: m[2] } : { name: s.trim(), dni: '' };
}

export function parseMarcacionFechaHora(fechaRaw: unknown, horaRaw: unknown): Date | null {
  const fecha = String(fechaRaw ?? '').trim();
  const hora = String(horaRaw ?? '').trim();
  const m = fecha.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const parts = hora.split(':').map(Number);
  const hh = parts[0];
  const mi = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  if (!Number.isFinite(hh)) return null;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), hh, mi, ss);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function marcacionDateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(d);
}

function readExcelRows(file: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(file, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
}

export function parseMarcacionesExcelCcCatalog(file: ArrayBuffer): MarcacionExcelRow[] {
  const rows = readExcelRows(file);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cc = String(row.CCosto ?? row.ccosto ?? row['Centro de costo'] ?? '').trim();
    if (!cc) continue;
    counts.set(cc, (counts.get(cc) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ccosto, count]) => ({ ccosto, count }))
    .sort((a, b) => b.count - a.count || a.ccosto.localeCompare(b.ccosto, 'es'));
}

export function parseMarcacionesExcelRows(file: ArrayBuffer): ParsedMarcacionRow[] {
  const rows = readExcelRows(file);
  const parsed: ParsedMarcacionRow[] = [];
  rows.forEach((row, idx) => {
    const { name, dni } = parseMarcacionNombre(row.Nombre);
    const ccosto = String(row.CCosto ?? row.ccosto ?? '').trim();
    const entryAt = parseMarcacionFechaHora(row['Fecha entrada'], row.Entrada);
    const exitAt = parseMarcacionFechaHora(row['Fecha salida'], row.Salida);
    if (!ccosto || !entryAt || !exitAt || exitAt <= entryAt) return;
    parsed.push({
      rowIndex: idx + 2,
      dni,
      employeeName: name,
      ccosto,
      entryAt,
      exitAt,
    });
  });
  return parsed;
}

export function mergeCcCatalog(
  existing: MarcacionExcelRow[],
  incoming: MarcacionExcelRow[],
): MarcacionExcelRow[] {
  const map = new Map<string, number>();
  for (const item of existing) map.set(item.ccosto, item.count);
  for (const item of incoming) map.set(item.ccosto, item.count);
  return [...map.entries()]
    .map(([ccosto, count]) => ({ ccosto, count }))
    .sort((a, b) => b.count - a.count || a.ccosto.localeCompare(b.ccosto, 'es'));
}

export function detectMarcacionesMonth(rows: ParsedMarcacionRow[]): { year: number; month: number } | null {
  if (!rows.length) return null;
  const key = marcacionDateKey(rows[0].entryAt);
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return null;
  return { year: y, month: m };
}

/**
 * Copia de `franjasParaMesSiguiente` (apps/web2/src/lib/planificacion/refuerzosRapido.ts): Functions no
 * importa de web2. Al pasar el servicio a otro mes, el refuerzo fijo queda con su patrón (sin fechas), una
 * franja con fechas seguidas hasta fin de mes pasa entera y las fechas de otro mes no se arrastran.
 */
const DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

type Franja = Record<string, unknown> & { specificDates?: unknown; refuerzoFijo?: { tipo?: string; desde?: string; dias?: string[] } };
type Puesto = Record<string, unknown> & { allowedShiftTypes?: Franja[]; shifts?: Franja[] };

export function franjasParaMesSiguiente(positions: readonly Puesto[], mesNuevo: string): Puesto[] {
  const ajustar = (s: Franja): Franja | null => {
    const marca = s.refuerzoFijo;
    const fechas = Array.isArray(s.specificDates) ? (s.specificDates as string[]) : [];
    if (marca?.tipo === 'FIJO' && String(marca.desde || '').slice(0, 7) >= mesNuevo) {
      const delMes = fechas.filter((f) => f.startsWith(mesNuevo));
      return fechas.length && !delMes.length ? null : (fechas.length ? { ...s, specificDates: delMes } : s);
    }
    if (marca?.tipo === 'FIJO') {
      const { specificDates: _sd, refuerzoFijo: _m, days: _d, ...resto } = s as Franja & { days?: unknown };
      const dias = DIAS.filter((d) => (marca.dias || []).includes(d));
      return dias.length && dias.length < 7 ? { ...resto, days: dias } : resto;
    }
    if (!fechas.length) return s;
    const delMes = fechas.filter((f) => f.startsWith(mesNuevo));
    if (delMes.length) return { ...s, specificDates: delMes };
    const orden = [...fechas].sort();
    const ultima = orden[orden.length - 1];
    const [y, m] = ultima.split('-').map(Number);
    const finMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const seguidas = orden.every((f, i) => i === 0 || Number(f.slice(8, 10)) === Number(orden[i - 1].slice(8, 10)) + 1);
    if (Number(ultima.slice(8, 10)) === finMes && seguidas) {
      const { specificDates: _sd, ...resto } = s;
      return resto;
    }
    return null;
  };
  const out: Puesto[] = [];
  for (const p of positions || []) {
    const lista = (p.allowedShiftTypes || []).map(ajustar).filter((x): x is Franja => !!x);
    const shifts = p.shifts ? p.shifts.map(ajustar).filter((x): x is Franja => !!x) : undefined;
    if ((p.allowedShiftTypes || []).length && !lista.length) continue;
    out.push({ ...p, allowedShiftTypes: lista, ...(shifts ? { shifts } : {}) });
  }
  return out;
}

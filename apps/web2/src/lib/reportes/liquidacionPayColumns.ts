/** Mismo corte que payrollApi: bolsa = reales − FT; simples = min(bolsa, 200); al 50% = bolsa − 200. */
export type LiquidacionPayColumns = {
  turnos: number;
  teoricas: number;
  normales: number;
  al50: number;
  ft: number;
  plusFeriado: number;
  total: number;
  diurnas: number;
  nocturnas: number;
};

export function liquidacionPayColumns(row: {
  shifts?: number;
  shiftsTotal?: number;
  horasTeoricas?: number;
  total?: number;
  horasReales?: number;
  extra100?: number;
  plusFeriado?: number;
  diurnas?: number;
  nocturnas?: number;
}): LiquidacionPayColumns {
  const ft = Math.max(0, Number(row.extra100) || 0);
  const reales = Math.max(0, Number(row.horasReales) || 0);
  const bolsa = Math.max(0, reales - ft);
  const normales = Math.min(bolsa, 200);
  const al50 = Math.max(0, bolsa - 200);
  return {
    turnos: Number(row.shifts ?? row.shiftsTotal) || 0,
    teoricas: Number(row.horasTeoricas ?? row.total) || 0,
    normales,
    al50,
    ft,
    plusFeriado: Math.max(0, Number(row.plusFeriado) || 0),
    total: normales + al50 + ft,
    diurnas: Math.max(0, Number(row.diurnas) || 0),
    nocturnas: Math.max(0, Number(row.nocturnas) || 0),
  };
}

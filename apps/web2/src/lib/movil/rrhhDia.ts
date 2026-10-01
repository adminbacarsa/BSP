export type AusenciaDia = {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  hasCertificate?: boolean;
  certificateUrl?: string | null;
  employeeId?: string;
};

function medica(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes('enferm') || t === 'art' || t.includes('art');
}

/** Tarjetas del día: sin KPIs ni plantilla. */
export function resumenDiaRrhh(hoy: string, rows: AusenciaDia[]) {
  const vivas = rows.filter((row) => row.status !== 'Rechazada' && row.startDate <= hoy && row.endDate >= hoy);
  return {
    ausenciasHoy: vivas,
    licencias: vivas.filter((row) => row.startDate === hoy || row.endDate === hoy),
    certificados: vivas.filter((row) => medica(row.type) && !row.hasCertificate && !row.certificateUrl),
  };
}

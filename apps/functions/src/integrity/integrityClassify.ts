/**
 * Clasificación de hallazgos de integridad. Solo informa: no corrige documentos.
 */

export type TurnoFinding =
  | 'turnoClienteInexistente'
  | 'turnoObjetivoInexistente'
  | 'turnoEmpresaDistinta';

export type ClientLookup = {
  empresaId: string;
  exists: boolean;
};

export function classifyTurnoFindings(
  turno: { clientId?: unknown; objectiveId?: unknown; empresaId?: unknown },
  clientsById: Map<string, ClientLookup>,
  objectiveIdsOfEmpresa: Set<string>,
): TurnoFinding[] {
  const out: TurnoFinding[] = [];
  const empresaId = String(turno.empresaId ?? '').trim();
  const clientId = String(turno.clientId ?? '').trim();
  const objectiveId = String(turno.objectiveId ?? '').trim();

  if (!clientId) {
    out.push('turnoClienteInexistente');
  } else {
    const client = clientsById.get(clientId);
    if (!client || !client.exists) out.push('turnoClienteInexistente');
    else if (String(client.empresaId || '').trim() !== empresaId) out.push('turnoEmpresaDistinta');
  }

  if (!objectiveId || !objectiveIdsOfEmpresa.has(objectiveId)) {
    out.push('turnoObjetivoInexistente');
  }
  return out;
}

export function slaClientIsMissing(
  clientId: unknown,
  clientsById: Map<string, ClientLookup>,
): boolean {
  const id = String(clientId ?? '').trim();
  if (!id) return true;
  const client = clientsById.get(id);
  return !client || !client.exists;
}

export const INTEGRITY_SAMPLE_CAP = 40;

export type IntegrityCounts = {
  turnoClienteInexistente: number;
  turnoObjetivoInexistente: number;
  turnoEmpresaDistinta: number;
  slaClienteInexistente: number;
};

export type IntegrityReportBody = {
  empresaId: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  counts: IntegrityCounts;
  samples: Record<keyof IntegrityCounts, string[]>;
  totalFindings: number;
  mode: 'report_only';
};

export function emptyIntegrityCounts(): IntegrityCounts {
  return {
    turnoClienteInexistente: 0,
    turnoObjetivoInexistente: 0,
    turnoEmpresaDistinta: 0,
    slaClienteInexistente: 0,
  };
}

export function pushSample(list: string[], id: string): void {
  if (list.length >= INTEGRITY_SAMPLE_CAP) return;
  if (!list.includes(id)) list.push(id);
}

export function totalFindings(counts: IntegrityCounts): number {
  return (
    counts.turnoClienteInexistente +
    counts.turnoObjetivoInexistente +
    counts.turnoEmpresaDistinta +
    counts.slaClienteInexistente
  );
}

export function arDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function integrityReportId(empresaId: string, date = arDateKey()): string {
  return `${String(empresaId).trim()}_${date}`;
}

export function scanLoadedEmpresa(input: {
  empresaId: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  turnos: Array<{ id: string; clientId?: unknown; objectiveId?: unknown; empresaId?: unknown }>;
  slas: Array<{ id: string; clientId?: unknown }>;
  clientsById: Map<string, ClientLookup>;
  objectiveIds: Set<string>;
}): IntegrityReportBody {
  const counts = emptyIntegrityCounts();
  const samples = {
    turnoClienteInexistente: [] as string[],
    turnoObjetivoInexistente: [] as string[],
    turnoEmpresaDistinta: [] as string[],
    slaClienteInexistente: [] as string[],
  };

  for (const turno of input.turnos) {
    const findings = classifyTurnoFindings(turno, input.clientsById, input.objectiveIds);
    for (const kind of findings) {
      counts[kind] += 1;
      pushSample(samples[kind], turno.id);
    }
  }
  for (const sla of input.slas) {
    if (!slaClientIsMissing(sla.clientId, input.clientsById)) continue;
    counts.slaClienteInexistente += 1;
    pushSample(samples.slaClienteInexistente, sla.id);
  }

  return {
    empresaId: input.empresaId,
    date: input.date,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    generatedAt: input.generatedAt,
    counts,
    samples,
    totalFindings: totalFindings(counts),
    mode: 'report_only',
  };
}

export function integrityNovedadDescription(reportId: string, counts: IntegrityCounts): string {
  const n = totalFindings(counts);
  return (
    `Integridad de datos (${reportId}): ${n} hallazgo(s). ` +
    `Turnos sin cliente ${counts.turnoClienteInexistente}, ` +
    `objetivo inexistente ${counts.turnoObjetivoInexistente}, ` +
    `empresa distinta ${counts.turnoEmpresaDistinta}, ` +
    `SLA sin cliente ${counts.slaClienteInexistente}. ` +
    'Solo informe: no se corrigió ningún documento.'
  );
}

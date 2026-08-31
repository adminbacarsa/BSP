export type ProformaDayCell = {
  date: string;
  display: string;
  hours: number;
  dayHours: number;
  nightHours: number;
};

export type ProformaEmployeeRow = {
  employeeId: string;
  legajo: string;
  name: string;
  days: Record<string, ProformaDayCell>;
  totalHours: number;
  totalDay: number;
  totalNight: number;
};

export type ProformaObjectiveGrid = {
  objectiveId: string;
  objectiveName: string;
  dateColumns: string[];
  dayLabels: Record<string, string>;
  employees: ProformaEmployeeRow[];
  dailyTotals: Record<string, { total: number; day: number; night: number }>;
  grandTotal: { total: number; day: number; night: number };
};

/** Fila de registro mensual por puesto (agrega horas de todos los legajos del puesto). */
export type ProformaPositionRow = {
  positionName: string;
  days: Record<string, ProformaDayCell>;
  totalHours: number;
  totalDay: number;
  totalNight: number;
};

export type ProformaPositionObjectiveGrid = {
  objectiveId: string;
  objectiveName: string;
  dateColumns: string[];
  dayLabels: Record<string, string>;
  positions: ProformaPositionRow[];
  dailyTotals: Record<string, { total: number; day: number; night: number }>;
  grandTotal: { total: number; day: number; night: number };
};

/** Qué páginas/secciones incluir en vista y PDF/CSV/Excel. */
export type ProformaLayoutMode = 'both' | 'employees' | 'positions';

export type ProformaSummaryRow = {
  objectiveName: string;
  totalHours: number;
  dayHours: number;
  nightHours: number;
  /** Horas SLA contratadas (vigente en el período); undefined si no se pudo resolver. */
  slaHours?: number;
};

export type ProformaEventoGuardia = {
  employeeId: string;
  name: string;
  fecha: string;
  hours: number;
};

export type ProformaEventoServicio = {
  servicioId: string;
  servicioNombre: string;
  fecha: string;
  horaInicio?: string;
  horaFin?: string;
  cupo?: number;
  guardias: ProformaEventoGuardia[];
  totalHoras: number;
};

export type ProformaEvento = {
  eventoId: string;
  eventoNombre: string;
  servicios: ProformaEventoServicio[];
  totalHoras: number;
};

export type ProformaExportBundle = {
  clientName: string;
  legalName: string;
  taxId: string;
  address: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  issuedAt: Date;
  empresaName: string;
  summary: ProformaSummaryRow[];
  objectives: ProformaObjectiveGrid[];
  /** Grillas diarias agregadas por puesto (registro mensual tipo Excel cliente). */
  positionGrids?: ProformaPositionObjectiveGrid[];
  /** Controla vista UI y export PDF/CSV/Excel. */
  layoutMode?: ProformaLayoutMode;
  eventos?: ProformaEvento[];
  /** Trazabilidad de lectura Firestore (solo UI pre-factura). */
  sourceDebug?: {
    clientId: string;
    turnosLoaded: number;
    turnosEligible: number;
    objectiveBlocks: number;
    catalogObjectives: number;
  };
};

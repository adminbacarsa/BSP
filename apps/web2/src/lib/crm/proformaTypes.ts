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

export type ProformaSummaryRow = {
  objectiveName: string;
  totalHours: number;
  dayHours: number;
  nightHours: number;
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
};

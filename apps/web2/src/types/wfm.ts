
export interface Client { id: string; name: string; cuit: string; }
export interface Objective { id: string; clientId: string; name: string; address: string; }
export interface Service { id: string; objectiveId: string; name: string; startTime: string; endTime: string; costPerHour: number; }
export interface Employee { id: string; name: string; role: string; fileNumber: string; }
export interface Assignment { id: string; serviceId: string; employeeId: string; date: string; }

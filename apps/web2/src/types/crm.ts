
export interface Contact { name: string; role: string; phone: string; email: string; }
export interface Objective { id?: string; clientId: string; name: string; address: string; status: 'active' | 'inactive'; }

export interface ServiceSLA {
  id?: string;
  objectiveId: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  days: number[];    // [1,2,3,4,5] (1=Lunes)
  headcount: number; // Personas requeridas
  costPerHour: number;
}

export interface Client {
  id?: string;
  name: string;
  cuit: string;
  industry: string;
  status: 'prospecto' | 'negociacion' | 'activo' | 'pausado';
  contacts: Contact[];
  timeline: any[];
}

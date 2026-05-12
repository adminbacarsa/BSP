
import axios from 'axios';

// CONFIGURACIÓN DE CONEXIÓN A BASE DE DATOS
// Cambiar baseURL por tu backend real (Node/Express/Python)
const API = axios.create({
  baseURL: 'http://localhost:4000/api', 
  headers: { 'Content-Type': 'application/json' }
});

// SIMULACIÓN DE DATOS (MOCK) PARA CUANDO NO HAY BACKEND
export const mockData = {
  login: async (creds: any) => {
    // Simula delay de red
    return new Promise(resolve => setTimeout(() => resolve({ token: '123', user: 'Admin' }), 800));
  },
  getEmployees: async () => [
    { id: 1020, name: 'Sartori, Franco', role: 'Vigilador', status: 'active' },
    { id: 1021, name: 'Quinteros, Debora', role: 'Monitor', status: 'medical' },
    { id: 1022, name: 'Gomez, Carlos', role: 'Supervisor', status: 'active' },
  ],
  getShifts: async () => {
    // Aquí iría la consulta real a tu DB de turnos
    return []; 
  }
};

export default API;

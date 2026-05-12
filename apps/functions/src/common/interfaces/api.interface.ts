// api.interface.ts (Ejemplo de respuesta estandarizada de API Gateway/Backend)
export interface IApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// employee.interface.ts (Aseguramos la interfaz de IEmployee)
export interface IEmployee {
  uid: string;
  name: string;
  role: string;
  // Añadir cualquier otro campo relevante (ej: maxHoursPerMonth, email)
}




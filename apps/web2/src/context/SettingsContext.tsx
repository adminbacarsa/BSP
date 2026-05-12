import React, { createContext, useContext, useState, useEffect } from 'react';

interface SettingsContextType {
  timezone: string;
  setTimezone: (tz: string) => void;
  locale: string;
}

const defaultSettings = {
  timezone: 'America/Argentina/Buenos_Aires', // Valor por defecto
  locale: 'es-AR'
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [timezone, setTimezoneState] = useState(defaultSettings.timezone);

  // Al iniciar, buscamos si hay algo guardado en el navegador
  useEffect(() => {
    const saved = localStorage.getItem('app_timezone');
    if (saved) setTimezoneState(saved);
  }, []);

  // Función para guardar el cambio
  const setTimezone = (tz: string) => {
    setTimezoneState(tz);
    localStorage.setItem('app_timezone', tz);
  };

  return (
    <SettingsContext.Provider value={{ timezone, setTimezone, locale: defaultSettings.locale }}>
      {children}
    </SettingsContext.Provider>
  );
}

// Hook para usar esto en cualquier parte de la app
export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings debe usarse dentro de un SettingsProvider');
  }
  return context;
}

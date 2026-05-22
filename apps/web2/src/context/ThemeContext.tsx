
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppTheme, applyTheme as applyThemeManager, getStoredTheme } from '@/lib/themeManager';

// Re-export AppTheme as Theme for backward compatibility
export type Theme = AppTheme;

interface ThemeContextType {
  theme: Theme;
  toggleTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyThemeManager(stored);

    const handler = (e: Event) => {
      const t = (e as CustomEvent<Theme>).detail;
      setTheme(t);
    };
    window.addEventListener('cosp:theme', handler);
    return () => window.removeEventListener('cosp:theme', handler);
  }, []);

  const toggleTheme = (t: Theme) => {
    setTheme(t);
    applyThemeManager(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme debe usarse dentro de un ThemeProvider');
  return context;
};

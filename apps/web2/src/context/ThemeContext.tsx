
import React, { createContext, useContext, useEffect, useState } from 'react';

// Definimos los 5 temas
export type Theme = 'enterprise' | 'tactical' | 'midnight' | 'oled' | 'modern';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>('enterprise');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) {
      setTheme(savedTheme);
      applyTheme(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const defaultTheme = prefersDark ? 'tactical' : 'enterprise';
      setTheme(defaultTheme);
      applyTheme(defaultTheme);
    }
  }, []);

  const applyTheme = (t: Theme) => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'enterprise', 'tactical', 'midnight', 'oled', 'modern');
    
    root.classList.add(t);

    // Modern es un tema CLARO ('light'), los otros 3 son OSCUROS ('dark')
    if (['tactical', 'midnight', 'oled'].includes(t)) {
      root.classList.add('dark');
    } else {
      root.classList.add('light');
    }

    localStorage.setItem('theme', t);
  };

  const toggleTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { paletteForMode, type AppPalette, type ThemeMode } from './palettes';

const STORAGE_KEY = 'cosp_guardia_theme_mode';

type ThemeContextValue = {
  mode: ThemeMode;
  palette: AppPalette;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('core');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'core' || stored === 'darkOps') setMode(stored);
      })
      .finally(() => setReady(true));
  }, []);

  const setThemeMode = useCallback(async (next: ThemeMode) => {
    setMode(next);
    await AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = mode === 'core' ? 'darkOps' : 'core';
    await setThemeMode(next);
  }, [mode, setThemeMode]);

  const value = useMemo(
    () => ({
      mode,
      palette: paletteForMode(mode),
      isDark: mode === 'darkOps',
      setThemeMode,
      toggleTheme,
    }),
    [mode, setThemeMode, toggleTheme],
  );

  if (!ready) {
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}

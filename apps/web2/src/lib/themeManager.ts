export type AppTheme = 'light' | 'dark' | 'blue' | 'contrast' | 'custom' | 'system';

export const THEMES: { id: AppTheme; label: string }[] = [
  { id: 'light',    label: 'Claro'         },
  { id: 'dark',     label: 'Oscuro'        },
  { id: 'blue',     label: 'Azul Pro'      },
  { id: 'contrast', label: 'Contraste'     },
  { id: 'custom',   label: 'Personalizado' },
  { id: 'system',   label: 'Sistema'       },
];

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'theme-blue', 'theme-contrast', 'theme-custom');

  switch (theme) {
    case 'dark':
      root.classList.add('dark');
      break;
    case 'blue':
      root.classList.add('dark', 'theme-blue');
      break;
    case 'contrast':
      root.classList.add('dark', 'theme-contrast');
      break;
    case 'custom':
      root.classList.add('theme-custom');
      break;
    case 'system':
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      }
      break;
    // 'light' — sin clases extra
  }

  localStorage.setItem('cosp-theme', theme);
  window.dispatchEvent(new CustomEvent('cosp:theme', { detail: theme }));
}

export function getStoredTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';
  // Soporta clave vieja y nueva
  return ((localStorage.getItem('cosp-theme') || localStorage.getItem('theme')) as AppTheme) || 'light';
}

export function initTheme(): void {
  applyTheme(getStoredTheme());
}

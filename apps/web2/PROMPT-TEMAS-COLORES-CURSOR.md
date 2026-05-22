# PROMPT CURSOR — Sistema de Temas y Colores Monocromáticos COSP V1.0

## OBJETIVO
Implementar el sistema completo de temas (Claro / Oscuro / Contraste / Personalizado) y el sistema de color monocromático de empresa en **todos los módulos** de la plataforma admin. La infraestructura base ya existe; este prompt la expande y la conecta a cada vista.

## RESTRICCIÓN CRÍTICA
**NO modificar ninguna lógica operativa, hooks, llamadas a Firestore, cálculos, modales funcionales ni flujos de datos.** Solo CSS, clases Tailwind de apariencia, variables CSS y el archivo `globals.css`. Si un componente tiene lógica mezclada con JSX visual, tocar **únicamente** los className de color/fondo/borde.

---

## CONTEXTO DEL PROYECTO

### Archivos clave ya existentes (NO recrear, solo modificar/extender):
- `src/styles/globals.css` — CSS variables por tema. YA tiene variables para `--sb-bg`, `--topbar-bg`, `--app-bg` en 4 temas.
- `src/lib/companyTheme.ts` — Genera paleta monocromática desde un hex de empresa. YA tiene `buildCompanyTheme(hex)` y `applyCompanyTheme(hex)`. Reemplaza clases `indigo-*` vía CSS override.
- `src/lib/themeManager.ts` — Aplica clases `dark`, `theme-blue`, `theme-contrast` en `<html>`. Persiste en `localStorage('cosp-theme')`.
- `src/components/admin/config/GeneralTab.tsx` — Selector de temas UI. YA llama a `applyTheme()` de themeManager.
- `src/context/ThemeContext.tsx` — Contexto viejo con nombres distintos ('enterprise', 'tactical'...). **Unificar con themeManager.**

### Temas existentes en themeManager.ts:
```
'light' | 'dark' | 'blue' | 'contrast' | 'system'
```

### Lo que hay que agregar: tema `'custom'` (dark total, zinc puro)

---

## PASO 1 — EXPANDIR `globals.css`

Agregar las siguientes variables a cada bloque de tema existente. No borrar nada de lo que ya está.

### Variables nuevas a agregar:

```css
/* Superficies de cards y paneles */
--surf:        /* fondo de tarjeta principal */
--surf2:       /* fondo secundario / hover row */
--surf3:       /* fondo terciario / inputs */

/* Textos */
--txt:         /* texto principal */
--txt2:        /* texto secundario */
--txt3:        /* texto muted / labels */

/* Bordes */
--border:      /* borde estándar */
--border2:     /* borde hover / énfasis */
```

### Valores por tema:

**`:root` (Claro — default):**
```css
--surf:        #ffffff;
--surf2:       #f8fafc;
--surf3:       #f1f5f9;
--txt:         #0f172a;
--txt2:        #475569;
--txt3:        #94a3b8;
--border:      rgba(0,0,0,.08);
--border2:     rgba(0,0,0,.15);
```

**`.dark:not(.theme-blue):not(.theme-contrast)` (Oscuro):**
```css
--surf:        #1e293b;
--surf2:       #0f172a;
--surf3:       #334155;
--txt:         #f1f5f9;
--txt2:        #cbd5e1;
--txt3:        #475569;
--border:      rgba(255,255,255,.07);
--border2:     rgba(255,255,255,.13);
```

**`.theme-blue` (Azul Pro):**
```css
--surf:        #1e3a8a;
--surf2:       #0f1f4a;
--surf3:       #1e3a8a;
--txt:         #e0e7ff;
--txt2:        #bfdbfe;
--txt3:        #6366f1;
--border:      rgba(99,102,241,.2);
--border2:     rgba(99,102,241,.4);
```

**`.theme-contrast` (Alto Contraste):**
```css
--surf:        #000000;
--surf2:       #0a0a0a;
--surf3:       #111111;
--txt:         #ffffff;
--txt2:        #FFD700;
--txt3:        #aaaaaa;
--border:      rgba(255,215,0,.4);
--border2:     #FFD700;
```

**`.theme-custom` (Personalizado — dark zinc total) — NUEVO BLOQUE:**
```css
.theme-custom {
  --sb-bg:          #09090b;
  --sb-border:      rgba(255,255,255,.07);
  --sb-text:        #a1a1aa;
  --sb-muted:       #52525b;
  --sb-section:     #27272a;
  --sb-active-bg:   var(--company-primary, #7c3aed);
  --sb-active-text: #ffffff;
  --sb-hover-bg:    #18181b;
  --sb-hover-text:  #f4f4f5;
  --sb-logo:        var(--company-primary-light, #a78bfa);
  --sb-logo-sub:    #52525b;
  --sb-logout:      #f43f5e;
  --sb-special-bg:  rgba(239,68,68,0.12);
  --sb-special-text:#fca5a5;
  --sb-special-border:rgba(239,68,68,0.3);

  --app-bg:         #09090b;
  --topbar-bg:      #111113;
  --topbar-border:  rgba(255,255,255,.07);
  --topbar-text:    #f4f4f5;

  --surf:           #111113;
  --surf2:          #18181b;
  --surf3:          #1c1c1f;
  --txt:            #f4f4f5;
  --txt2:           #a1a1aa;
  --txt3:           #52525b;
  --border:         rgba(255,255,255,.07);
  --border2:        rgba(255,255,255,.13);
}
```

**Agregar también para `.theme-custom` los overrides de colores oscuros:**
```css
.theme-custom body                { background-color: #09090b !important; color: #f4f4f5 !important; }
.theme-custom .bg-white           { background-color: #111113 !important; }
.theme-custom .bg-slate-50        { background-color: #09090b !important; }
.theme-custom .bg-slate-100       { background-color: #18181b !important; }
.theme-custom .bg-gray-50         { background-color: #09090b !important; }
.theme-custom .bg-gray-100        { background-color: #18181b !important; }
.theme-custom .border-slate-200   { border-color: rgba(255,255,255,.07) !important; }
.theme-custom .border-slate-100   { border-color: rgba(255,255,255,.05) !important; }
.theme-custom .border-gray-200    { border-color: rgba(255,255,255,.07) !important; }
.theme-custom .text-slate-900     { color: #f4f4f5 !important; }
.theme-custom .text-slate-800     { color: #e4e4e7 !important; }
.theme-custom .text-slate-700     { color: #d4d4d8 !important; }
.theme-custom .text-slate-600     { color: #a1a1aa !important; }
.theme-custom .text-gray-900      { color: #f4f4f5 !important; }
.theme-custom .text-gray-800      { color: #e4e4e7 !important; }
.theme-custom input, .theme-custom select, .theme-custom textarea {
  background-color: #18181b !important;
  border-color: rgba(255,255,255,.1) !important;
  color: #f4f4f5 !important;
}
```

---

## PASO 2 — ACTUALIZAR `themeManager.ts`

Agregar `'custom'` al tipo `AppTheme` y al switch:

```typescript
export type AppTheme = 'light' | 'dark' | 'blue' | 'contrast' | 'custom' | 'system';

export const THEMES: { id: AppTheme; label: string }[] = [
  { id: 'light',    label: 'Claro'         },
  { id: 'dark',     label: 'Oscuro'        },
  { id: 'contrast', label: 'Contraste'     },
  { id: 'blue',     label: 'Azul Pro'      },
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
  }

  localStorage.setItem('cosp-theme', theme);
  window.dispatchEvent(new CustomEvent('cosp:theme', { detail: theme }));
}
```

---

## PASO 3 — ACTUALIZAR `GeneralTab.tsx` (selector de temas)

Agregar el botón del tema "Personalizado" en la grilla de temas. Cambiar el grid de 5 a 6 columnas. El botón va DESPUÉS del de Contraste y ANTES del de Sistema. Mantener los 5 botones existentes sin cambios funcionales.

```tsx
// Cambiar grid: grid-cols-2 md:grid-cols-5  →  grid-cols-2 md:grid-cols-6

{/* PERSONALIZADO — nuevo botón */}
<button 
  onClick={() => handleApplyTheme('custom')} 
  aria-pressed={theme === 'custom'} 
  aria-label="Tema Personalizado (Dark zinc total)"
  className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-3 transition-all hover:scale-105 ${
    theme === 'custom' 
      ? 'border-violet-500 bg-zinc-900 text-white' 
      : 'border-slate-100 hover:border-slate-300'
  }`}
>
  <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shadow-sm">
    {/* Usar el ícono Layers de lucide-react */}
    <Layers size={20} className="text-violet-400" aria-hidden="true"/>
  </div>
  <span className="text-xs font-black uppercase text-slate-600">Personalizado</span>
</button>
```

Agregar `Layers` al import de lucide-react en `GeneralTab.tsx`.

---

## PASO 4 — EXPANDIR `companyTheme.ts`

La función `buildBrandCSS()` actualmente solo reemplaza clases `indigo-*`. Extenderla para cubrir también clases `violet-*`, `purple-*` y `blue-*` que se usan en algunos módulos, siguiendo exactamente el mismo patrón que ya tiene para `indigo-*`.

Agregar dentro de `buildBrandCSS()` los siguientes bloques (DESPUÉS del bloque indigo existente):

```css
/* ── violet-* (usado en modales y algunos módulos) ── */
html[data-brand] .bg-violet-600,
html[data-brand] .bg-violet-500 { background-color: var(--company-primary) !important; }
html[data-brand] .bg-violet-50  { background-color: var(--company-primary-lightest) !important; }
html[data-brand] .bg-violet-100 { background-color: var(--company-primary-lighter) !important; }
html[data-brand] .text-violet-600,
html[data-brand] .text-violet-500 { color: var(--company-primary) !important; }
html[data-brand] .text-violet-700 { color: var(--company-primary-dark) !important; }
html[data-brand] .text-violet-400 { color: var(--company-primary-light) !important; }
html[data-brand] .border-violet-300,
html[data-brand] .border-violet-400,
html[data-brand] .border-violet-500 { border-color: var(--company-primary) !important; }
html[data-brand] .from-violet-500,
html[data-brand] .from-violet-600 { --tw-gradient-from: var(--company-primary) !important; }
html[data-brand] .to-violet-600,
html[data-brand] .to-violet-700  { --tw-gradient-to: var(--company-primary-dark) !important; }

/* dark overrides para violet */
html.dark[data-brand] .bg-violet-50  { background-color: var(--company-primary-dark-card)  !important; }
html.dark[data-brand] .bg-violet-100 { background-color: var(--company-primary-dark-card2) !important; }
html.dark[data-brand] .text-violet-600,
html.dark[data-brand] .text-violet-500 { color: var(--company-primary-on-dark) !important; }
html.dark[data-brand] .text-violet-400 { color: var(--company-primary-light) !important; }

/* theme-custom overrides para violet */
html.theme-custom[data-brand] .bg-violet-50,
html.theme-custom[data-brand] .bg-violet-100 { background-color: var(--company-primary-dark-card) !important; }
html.theme-custom[data-brand] .text-violet-600,
html.theme-custom[data-brand] .text-violet-500 { color: var(--company-primary-on-dark) !important; }
```

También agregar al objeto `buildCompanyTheme()` las variables que necesita el tema custom para las tarjetas KPI del Dashboard. Después de `'--company-primary-dark-border'`, agregar:

```typescript
'--company-primary-glow':      hex + '30',   // sombra/glow sutil
'--company-primary-active-bg': hslToHex(h, Math.min(sat, 40), 9),  // bg activo en dark
'--company-primary-tag-bg':    hslToHex(h, Math.min(sat, 35), 14), // fondo de tags
'--company-primary-tag-text':  hslToHex(h, Math.min(sat, 72), 68), // texto de tags
```

---

## PASO 5 — APLICAR VARIABLES CSS EN MÓDULOS

Para cada uno de los 7 módulos de admin, reemplazar las clases de fondo/borde/texto de contenedores principales por las nuevas variables CSS. **NO tocar ningún className que controle layout (flex, grid, padding, margin, width), íconos de estado (colores semánticos como rojo=alerta, verde=presente) ni lógica condicional.**

### Patrón de reemplazo estándar:

| Tailwind actual | Reemplazar por |
|---|---|
| `bg-white dark:bg-slate-800` | `bg-[var(--surf)]` |
| `bg-slate-50 dark:bg-slate-900` | `bg-[var(--surf2)]` |
| `bg-slate-100 dark:bg-slate-800` | `bg-[var(--surf3)]` |
| `border-slate-200 dark:border-slate-700` | `border-[var(--border)]` |
| `text-slate-900 dark:text-white` | `text-[var(--txt)]` |
| `text-slate-600 dark:text-slate-300` | `text-[var(--txt2)]` |
| `text-slate-500 dark:text-slate-400` | `text-[var(--txt3)]` |

### Archivos a actualizar (contenedores/cards principales únicamente):

#### `src/pages/admin/dashboard.tsx`
- El `<PageShell>` o `<div>` raíz de contenido
- Las tarjetas KPI (clases `bg-white`, `border-slate-200`)
- La sección de licencias (tabla o lista)
- Los wrappers de gráficos

#### `src/pages/admin/operaciones/index.tsx`
- El panel derecho "Estado de Operaciones"
- Las filas de la tabla de objetivos
- Los contadores (PRES./PLAN./RET./VAC./AUS./TOTAL)
- **NO tocar** colores de estado operativo (verde=presente, rojo=vacante, amarillo=retención)
- **NO tocar** los modales (HandoverModal, InterruptModal, CoverageModal) — sus colores de header son semánticos

#### `src/pages/admin/planificacion/index.tsx`
- El toolbar superior
- El header de la grilla (fila de días)
- La columna sticky de nombres
- **NO tocar** los colores de turno (SHIFT_STYLES: M=azul, T=naranja, N=índigo, etc.) — son semánticos operativos

#### `src/pages/admin/crm/index.tsx`
- Contenedor de lista de clientes (izquierda)
- Panel de detalle (derecha)
- Cards de objetivo
- **NO tocar** colores de estado de contrato/servicio

#### `src/pages/admin/rrhh/index.tsx`
- Cards de empleados
- Tabla de ausencias
- Sección de convenios
- **NO tocar** colores de estado (activo/ausente/vacaciones)

#### `src/pages/admin/reportes/index.tsx`
- Contenedor de filtros
- Tabla de datos
- **NO tocar** colores de estado en celdas

#### `src/components/admin/config/GeneralTab.tsx`
- El card de "TEMAS Y APARIENCIA" (ya existe)
- El card de "DATOS DE LA ORGANIZACIÓN"
- **NO tocar** la zona de mantenimiento (mantener su estilo rose/rojo de advertencia)

---

## PASO 6 — UNIFICAR `ThemeContext.tsx` CON `themeManager.ts`

El archivo `ThemeContext.tsx` usa nombres distintos ('enterprise', 'tactical', 'midnight'...) que ya no se usan. Actualizar para que sea un wrapper limpio de `themeManager`:

```typescript
// src/context/ThemeContext.tsx — versión unificada
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppTheme, applyTheme, getStoredTheme } from '@/lib/themeManager';

interface ThemeContextType {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<AppTheme>('light');

  useEffect(() => {
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  const setTheme = (t: AppTheme) => {
    setThemeState(t);
    applyTheme(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return context;
};

// Re-exportar el tipo para retrocompatibilidad
export type { AppTheme as Theme };
```

---

## PASO 7 — CONECTAR COLOR DE EMPRESA EN TODA LA APP

En `src/pages/_app.tsx`, después de inicializar el tema, aplicar también el color de empresa desde storage:

```typescript
// Dentro del useEffect de inicialización (o en _document.tsx si aplica):
import { applyCompanyThemeFromStorage } from '@/lib/companyTheme';
import { initTheme } from '@/lib/themeManager';

// En el useEffect de init:
useEffect(() => {
  initTheme();
  applyCompanyThemeFromStorage();
}, []);
```

Si `_app.tsx` ya tiene este hook, agregar solo `applyCompanyThemeFromStorage()` sin duplicar nada.

---

## PASO 8 — AGREGAR SELECTOR DE COLOR EN `GeneralTab.tsx` (sección nueva)

Después del bloque de "TEMAS Y APARIENCIA", agregar una nueva sección "COLOR DE EMPRESA" que permita al SuperAdmin definir el color de acento de la empresa activa. Este color se guarda en Firestore (`empresas/{empresaId}`) y en localStorage (`cosp_last_primary_color`).

```tsx
{/* COLOR DE EMPRESA */}
<div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl">
  <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2 flex items-center gap-2">
    <Palette className="text-indigo-600"/> COLOR DE EMPRESA
  </h3>
  <p className="text-xs text-slate-400 mb-6 font-medium">
    El color de empresa define la gama de tonos que se aplica en el sidebar, botones y elementos activos para esta empresa.
    Se aplica combinado con el tema seleccionado.
  </p>
  
  {/* Colores preset */}
  <div className="flex gap-3 flex-wrap mb-4">
    {[
      { hex: '#f97316', label: 'Naranja'  },
      { hex: '#7c3aed', label: 'Violeta'  },
      { hex: '#2563eb', label: 'Azul'     },
      { hex: '#16a34a', label: 'Verde'    },
      { hex: '#dc2626', label: 'Rojo'     },
      { hex: '#0d9488', label: 'Teal'     },
      { hex: '#d97706', label: 'Ámbar'    },
      { hex: '#db2777', label: 'Rosa'     },
    ].map(({ hex, label }) => (
      <button
        key={hex}
        onClick={() => handleApplyCompanyColor(hex)}
        title={label}
        className={`w-9 h-9 rounded-lg border-2 transition-all hover:scale-110 ${
          companyColor === hex ? 'border-white scale-110 shadow-lg' : 'border-transparent'
        }`}
        style={{ background: hex }}
        aria-label={`Color ${label}`}
      />
    ))}
  </div>
  
  {/* Input hex custom */}
  <div className="flex items-center gap-3">
    <input
      type="color"
      value={companyColor}
      onChange={e => handleApplyCompanyColor(e.target.value)}
      className="w-12 h-10 rounded-lg cursor-pointer border-2 border-slate-200 dark:border-slate-700"
      aria-label="Color personalizado (selector)"
    />
    <input
      type="text"
      value={companyColor}
      onChange={e => {
        if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
          handleApplyCompanyColor(e.target.value);
        }
      }}
      placeholder="#7c3aed"
      className="font-mono text-sm p-2 border-2 border-slate-200 dark:border-slate-700 rounded-lg w-28 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white"
      aria-label="Código hex del color"
    />
    <span className="text-xs text-slate-400 font-medium">Hex personalizado</span>
  </div>
</div>
```

**Estado y handlers a agregar en `GeneralTab.tsx`:**

```typescript
import { applyCompanyTheme } from '@/lib/companyTheme';
import { Palette } from 'lucide-react';

// Estado (junto a los otros useState):
const [companyColor, setCompanyColor] = useState(
  localStorage.getItem('cosp_last_primary_color') || '#6366f1'
);

// Handler:
const handleApplyCompanyColor = (hex: string) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  setCompanyColor(hex);
  applyCompanyTheme(hex);
  // Guardar en Firestore si hay empresaId:
  if (empresaId) {
    setDoc(
      doc(db, 'empresas', empresaId),
      { brandColor: hex, updatedAt: new Date().toISOString() },
      { merge: true }
    ).catch(() => {});
  }
};
```

---

## PASO 9 — CARGAR COLOR DE EMPRESA DESDE FIRESTORE AL INICIAR

En `src/context/EmpresaContext.tsx` (o donde se cargue la empresa activa), cuando se cargue el documento de la empresa, aplicar su `brandColor` si existe:

```typescript
import { applyCompanyTheme } from '@/lib/companyTheme';

// Dentro del useEffect que carga la empresa:
if (empresaData.brandColor && /^#[0-9a-fA-F]{6}$/.test(empresaData.brandColor)) {
  applyCompanyTheme(empresaData.brandColor);
}
```

Esto garantiza que cada vez que el usuario entra a la app, el color correcto de la empresa se aplica automáticamente.

---

## RESUMEN DE ARCHIVOS A MODIFICAR

| Archivo | Tipo de cambio |
|---|---|
| `src/styles/globals.css` | Agregar variables `--surf`, `--surf2`, `--surf3`, `--txt`, `--txt2`, `--txt3`, `--border`, `--border2` en cada tema + nuevo bloque `.theme-custom` |
| `src/lib/themeManager.ts` | Agregar tipo `'custom'`, case en switch, limpiar clase `theme-custom` |
| `src/lib/companyTheme.ts` | Agregar cobertura de `violet-*` y `purple-*` en `buildBrandCSS()` + 4 variables nuevas en `buildCompanyTheme()` |
| `src/context/ThemeContext.tsx` | Reescribir como wrapper de themeManager — NO cambiar la API de exports |
| `src/components/admin/config/GeneralTab.tsx` | Agregar botón tema "Personalizado" + nueva sección "Color de empresa" + handlers |
| `src/context/EmpresaContext.tsx` | Llamar `applyCompanyTheme(brandColor)` al cargar empresa |
| `src/pages/_app.tsx` | Llamar `applyCompanyThemeFromStorage()` en init |
| `src/pages/admin/dashboard.tsx` | Reemplazar `bg-white dark:bg-slate-800` → `bg-[var(--surf)]` en tarjetas y wrappers |
| `src/pages/admin/operaciones/index.tsx` | Idem — solo contenedores estructurales, NO colores semánticos operativos |
| `src/pages/admin/planificacion/index.tsx` | Idem — solo toolbar y contenedores, NO SHIFT_STYLES |
| `src/pages/admin/crm/index.tsx` | Idem |
| `src/pages/admin/rrhh/index.tsx` | Idem |
| `src/pages/admin/reportes/index.tsx` | Idem |
| `src/components/admin/config/GeneralTab.tsx` | Ya cubierto arriba |

## ARCHIVOS A NO MODIFICAR
- Todos los archivos en `src/lib/planificacion/` (lógica de negocio)
- `src/hooks/` (hooks operativos)
- `src/components/operaciones/OperationalModals.tsx` (lógica de modales)
- `src/components/operaciones/RetentionModal.tsx`
- Firebase config, auth, Firestore queries
- `src/lib/planificacion/constants.ts` (SHIFT_STYLES con colores de turno)

---

## VERIFICACIÓN FINAL

Después de aplicar los cambios, verificar en el browser:

1. En Configuración → Sistema → "TEMAS Y APARIENCIA", los 6 botones deben estar presentes y funcionales
2. Cambiar tema: todos los fondos, textos y bordes deben cambiar en tiempo real
3. Cambiar color de empresa (naranja → violeta → azul): el sidebar, badges y elementos activos deben cambiar de tono
4. Recargar la página: el tema y color deben persistir (localStorage)
5. En modo "Personalizado" con naranja: el fondo debe ser zinc oscuro (#09090b), las tarjetas #111113, sidebar con acentos naranjas
6. Los colores semánticos operativos (verde=presente, rojo=vacante, amarillo=retención, colores de turno M/T/N) NO deben cambiar con ningún tema

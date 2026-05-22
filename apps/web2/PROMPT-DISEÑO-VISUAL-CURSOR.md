# PROMPT CURSOR — Rediseño Visual COSP V1.0
## Aplicar sistema de diseño zinc + color monocromático de empresa en todos los módulos

## OBJETIVO
La infraestructura de temas (themeManager, companyTheme, globals.css) ya está funcionando.
Ahora hay que cambiar los className de los componentes para que realmente usen las variables CSS `--surf`, `--surf2`, `--txt`, `--txt2`, `--txt3`, `--border`, `--company-primary`.

## RESTRICCIÓN CRÍTICA
- **SOLO** cambiar `className` de apariencia visual (colores, fondos, bordes, sombras, radio)
- **NO** tocar: lógica, props, state, hooks, eventos onClick, Firestore calls, algoritmos, SHIFT_STYLES
- Si un className controla layout (flex, grid, gap, p-*, m-*, w-*, h-*, col-span-*), **no tocarlo**

---

## ARCHIVO 1 — `src/components/ui/index.tsx`

Este archivo define los componentes compartidos por todos los módulos. Es el cambio más impactante.

### `PageShell` — línea ~50:
```tsx
// ANTES:
<div className={`min-h-screen bg-slate-50/50 dark:bg-slate-900 p-6 pb-20 animate-in fade-in ${className}`}>

// DESPUÉS:
<div className={`min-h-screen p-6 pb-20 animate-in fade-in ${className}`}
  style={{ backgroundColor: 'var(--app-bg)' }}>
```

### `PageHeader` — icono (~línea 67):
```tsx
// ANTES:
<div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">

// DESPUÉS:
<div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
  style={{ background: 'var(--company-primary, #6366f1)' }}>
```

### `PageHeader` — título y subtítulo:
```tsx
// ANTES:
<h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
<p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">

// DESPUÉS:
<h1 className="text-2xl font-black tracking-tight uppercase" style={{ color: 'var(--txt)' }}>
<p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>
```

### `ContentCard` — línea ~87:
```tsx
// ANTES:
<div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm ${padding ? 'p-6' : ''} ${className}`}>

// DESPUÉS:
<div className={`rounded-xl border ${padding ? 'p-6' : ''} ${className}`}
  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
```

### `MetricCard` — línea ~28:
```tsx
// ANTES:
<div ... className={`bg-white dark:bg-slate-800 px-4 py-3.5 rounded-xl border shadow-sm hover:shadow-md transition-all flex items-center gap-3
  ${alert ? 'border-rose-300 dark:border-rose-800 ring-1 ring-rose-200 dark:ring-rose-900' : 'border-slate-100 dark:border-slate-700'}
  ${noData ? 'opacity-55' : ''}`}>

// DESPUÉS:
<div ... className={`px-4 py-3.5 rounded-xl border transition-all flex items-center gap-3
  ${noData ? 'opacity-55' : ''}`}
  style={{
    backgroundColor: 'var(--surf)',
    borderColor: alert ? 'rgba(239,68,68,0.5)' : 'var(--border)',
    borderTop: `2px solid ${color}`,
  }}>
```

### `MetricCard` — textos internos:
```tsx
// ANTES:
<p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider leading-tight truncate">
<p className={`text-xl font-black leading-tight ${noData ? 'text-slate-300 dark:text-slate-600' : 'text-slate-800 dark:text-white'}`}>
{subtext && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight truncate">}

// DESPUÉS:
<p className="text-[9px] font-black uppercase tracking-wider leading-tight truncate" style={{ color: 'var(--txt3)' }}>
<p className="text-xl font-black leading-tight" style={{ color: noData ? 'var(--txt3)' : 'var(--txt)' }}>
{subtext && <p className="text-[10px] font-medium leading-tight truncate" style={{ color: 'var(--txt3)' }}>}
```

### `TabBar` — contenedor (~línea 104):
```tsx
// ANTES:
className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-slate-700 flex-wrap"

// DESPUÉS:
className="flex items-center gap-1 p-1 rounded-xl border flex-wrap"
style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}
```

### `TabBar` — botón activo vs inactivo (~línea 112):
```tsx
// ANTES:
${active === tab.id
  ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}

// DESPUÉS:
// Usar inline style condicional — NO className para colores:
style={active === tab.id ? {
  backgroundColor: 'var(--surf)',
  color: 'var(--company-primary, #6366f1)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
} : {
  color: 'var(--txt3)',
}}
// Quitar los className de color del botón (mantener solo los de layout/padding/rounded)
```

### `TabBar` — badge de count activo:
```tsx
// ANTES:
${active === tab.id ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'}

// DESPUÉS:
// Inline style:
style={active === tab.id ? {
  background: 'var(--company-primary, #6366f1)',
  color: '#fff',
} : {
  background: 'var(--surf3)',
  color: 'var(--txt3)',
}}
// Quitar los className de color del span
```

### `SectionTitle` — línea ~7:
```tsx
// ANTES:
<span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 whitespace-nowrap">
<div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />

// DESPUÉS:
<span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap" style={{ color: 'var(--txt3)' }}>
<div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
```

### `ModuleShell` — contenedor principal (~línea 176):
```tsx
// ANTES:
<div className="min-h-screen bg-slate-50/50 dark:bg-slate-900 p-6 pb-20 animate-in fade-in">

// DESPUÉS:
<div className="min-h-screen p-6 pb-20 animate-in fade-in" style={{ backgroundColor: 'var(--app-bg)' }}>
```

### `ModuleShell` — icono del header (~línea 180):
```tsx
// ANTES:
<div className={`w-10 h-10 ${iconColor} rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0`}>

// DESPUÉS:
<div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
  style={{ background: 'var(--company-primary, #6366f1)' }}>
// Eliminar la prop `iconColor` del uso (ahora siempre usa company-primary)
```

### `ModuleShell` — textos del header:
```tsx
// ANTES:
<h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
<p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">

// DESPUÉS (igual que PageHeader):
<h1 className="text-2xl font-black tracking-tight uppercase" style={{ color: 'var(--txt)' }}>
<p className="text-xs font-medium mt-0.5" style={{ color: 'var(--txt3)' }}>
```

### `ModuleShell` — barra de búsqueda (~línea 198):
```tsx
// ANTES:
<div className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center gap-3 px-4 py-3 shadow-sm">
<input ... className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-700 dark:text-white placeholder:text-slate-400 placeholder:font-normal uppercase"

// DESPUÉS:
<div className="flex-1 rounded-xl border flex items-center gap-3 px-4 py-3"
  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
<input ... className="flex-1 bg-transparent outline-none text-sm font-bold uppercase"
  style={{ color: 'var(--txt)' }}
```

### `ModuleShell` — toggle de vista (~línea 211):
```tsx
// ANTES:
<div ... className="flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
// botón activo: bg-indigo-600 text-white
// botón inactivo: text-slate-400 hover:text-slate-600 dark:hover:text-slate-300

// DESPUÉS:
<div ... className="flex items-center rounded-xl overflow-hidden border"
  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
// botón activo: style={{ background: 'var(--company-primary,#6366f1)', color: '#fff' }}
// botón inactivo: style={{ color: 'var(--txt3)' }}
```

### `ModuleShell` — cards de items (~línea 262):
```tsx
// ANTES:
<div key={item.id} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm transition-all overflow-hidden
  ${isOpen ? 'border-indigo-300 dark:border-indigo-700 shadow-md ring-1 ring-indigo-200 dark:ring-indigo-800 ...' : 'border-slate-200 dark:border-slate-700 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700'}`}>

// DESPUÉS:
<div key={item.id} className="rounded-xl border transition-all overflow-hidden"
  style={{
    backgroundColor: 'var(--surf)',
    borderColor: isOpen ? 'var(--company-primary, #6366f1)' : 'var(--border)',
  }}>
```

### `ModuleShell` — expanded panel (~línea 282):
```tsx
// ANTES:
<div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150">

// DESPUÉS:
<div className="border-t px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-150"
  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surf2)' }}>
```

### `ModuleShell` — lista view contenedor (~línea 294):
```tsx
// ANTES:
<div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

// DESPUÉS:
<div className="rounded-xl border overflow-hidden"
  style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
```

---

## ARCHIVO 2 — `src/components/admin/config/GeneralTab.tsx`

Cambiar el estilo de las cards de sección (aplica a las 4 cards: TEMAS, COLOR DE EMPRESA, DATOS, PORTALES).

### Reemplazo global en GeneralTab.tsx:
Buscar y reemplazar el patrón de card principal — todas las ocurrencias de:
```
bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl
```
por:
```
rounded-xl border p-8
// + style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}
```

### Títulos de sección dentro de las cards:
```tsx
// ANTES:
<h3 className="text-xl font-black text-slate-800 dark:text-white mb-6 flex items-center gap-2">

// DESPUÉS:
<h3 className="text-xl font-black mb-6 flex items-center gap-2" style={{ color: 'var(--txt)' }}>
```

### Labels de input:
```tsx
// ANTES:
className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block"

// DESPUÉS:
className="text-[10px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'var(--txt3)' }}
```

### Inputs:
```tsx
// ANTES:
className="w-full p-4 bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl font-bold text-slate-900 dark:text-white outline-none transition-all"

// DESPUÉS:
className="w-full p-4 border-2 focus:outline-none rounded-xl font-bold transition-all"
style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
// focus: usar onFocus/onBlur o CSS en globals.css
```

### Botones de tema (los 6 botones CLARO/OSCURO/etc.):
Solo cambiar el estado inactivo (deseleccionado) — quitar el fondo blanco/slate, usar variables:
```tsx
// ANTES (estado inactivo):
'border-slate-100 hover:border-slate-300'

// DESPUÉS (estado inactivo):
className con border usando var(--border) — agregar inline style en el className condicional
```

---

## ARCHIVO 3 — `src/styles/globals.css` (adición)

Al FINAL del archivo (antes del bloque de `@media print`), agregar:

```css
/* ═══════════════════════════════════════════════════════════════
   FOCUS RING — usa color de empresa en inputs del tema actual
   ═══════════════════════════════════════════════════════════════ */
input:focus, select:focus, textarea:focus {
  border-color: var(--company-primary, #6366f1) !important;
  box-shadow: 0 0 0 2px var(--company-primary-ring, rgba(99,102,241,0.2)) !important;
}

/* Scrollbar personalizado para tema zinc */
.theme-custom ::-webkit-scrollbar-thumb {
  background: #3f3f46;
}
.theme-custom ::-webkit-scrollbar-track {
  background: transparent;
}

/* Texto muted en cualquier tema */
.text-muted { color: var(--txt3) !important; }
.text-primary-theme { color: var(--txt) !important; }
.bg-surf { background-color: var(--surf) !important; }
.border-theme { border-color: var(--border) !important; }
```

---

## RESUMEN DEL EFECTO VISUAL

Con estos cambios, en el tema **ZINC + color naranja**:

| Elemento | Antes | Después |
|---|---|---|
| Fondo de página | `bg-slate-50` | `#09090b` (zinc casi negro) |
| Cards de módulo | `bg-white` blanco/slate, `rounded-[2rem]` | `#18181b` zinc, `rounded-xl` |
| KPI cards | borde gris uniforme | tira superior del color de empresa |
| Icono de sección | `bg-indigo-600` azul fijo | `var(--company-primary)` naranja |
| TabBar activo | `bg-indigo-600` | color de empresa |
| Textos | `text-slate-900 dark:text-white` | `var(--txt)` según tema |
| Inputs | `bg-slate-50 dark:bg-slate-900` | `var(--surf2)` según tema |
| Botón empresa (topbar) | naranja si se configuró ✓ | igual |
| Sidebar | variables CSS ya funcionan ✓ | sin cambio |

En **CLARO + color violeta**: mismo cambio pero fondos blancos, textos oscuros, acentos violetas.
En **CONTRASTE**: fondos negros, textos amarillos, acentos amarillos.

## VERIFICACIÓN
1. Navegar a Dashboard → las KPI cards deben tener la tira de color de empresa arriba
2. TabBar en Configuración → el tab activo debe mostrar el color de empresa
3. Cambiar de tema → toda la app cambia sin recargar
4. Cambiar color de empresa → la tira de KPI cards, iconos y TabBar activo cambian de color

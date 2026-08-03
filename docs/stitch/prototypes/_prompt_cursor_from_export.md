# PROMPT CURSOR — Implementación Temas Core & Dark (COSP Guardia)

**Objetivo:** Implementar el rediseño visual en `apps/mobile-guardia` basado en los sistemas de diseño **COSP Guardia Core** (Light) y **Dark Ops** (Dark). La implementación debe realizarse exclusivamente mediante `StyleSheet` y el archivo de tokens, sin alterar la lógica de negocio, hooks de Firebase o servicios de geolocalización.

---

## 1. Configuración de Tokens (`src/theme/tokens.ts`)
Actualiza el archivo de tokens para soportar ambos esquemas de color de forma dinámica o mediante constantes:

### Esquema Core (Light - Referencia {{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_4}})
- **Primary:** `#4f46e5` (Indigo) | **Header:** `#312e81`
- **Success/Action:** `#059669` (Emerald)
- **Surface:** `#f9f9ff` (Fondo general)
- **Cards:** `#ffffff` (Blanco puro)
- **Text:** `#1e293b` (Slate-900)
- **Radios:** `md: 16px`, `lg: 20px`, `xl: 24px`
- **Sombras:** Suaves, naturales (no flat).

### Esquema Dark Ops (Dark - Referencia {{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_2}})
- **Surface:** `#0b1326` (Deep Navy)
- **Cards:** `#131b2e` (Slate-900) con bordes en `#171e2e`
- **Accent/Success:** `#10b981` (Emerald-Neon)
- **Text:** `#f1f5f9` (Slate-100)
- **Sombras:** Reemplazar por bordes sutiles (1px) o elevación mínima.

---

## 2. Componentes de UI Críticos (`src/components/ui/*`)

### HeroShiftPanel
- **Core:** Card con gradiente de `#4f46e5` a `#312e81`. Texto en blanco.
- **Dark:** Card con fondo `#131b2e`, borde color esmeralda neón (opacidad 20%) y un indicador de estado (punto brillante).
- **Contenido:** Reloj de turno en `ExtraBold`, ubicación del objetivo y chips de "Exterior" / "Frecuencia".

### CommandButton
- Altura mínima de `52px` para operatividad con guantes.
- **Variante Success:** Fondo Emerald sólido para el botón "Marcar presente (GPS)".
- **Variante Secondary/Ghost:** Para "Informar llegada tarde" o "Reportar retraso".

### StatusBanner (Alertas)
- Fondo `#fee2e2` con texto `#dc2626` para fichadas pendientes (en modo Core).
- En modo Dark, usar un fondo bordó oscuro desaturado con texto claro.

---

## 3. Estructura de Pantallas (`app/*.tsx`)

### Home (`home.tsx`)
- Priorizar el `HeroShiftPanel` en el tercio superior.
- Debajo, botones de acción inmediata (Fichada GPS) centrados y prominentes.
- Sección de "Logs de actividad" o "Última novedad" con diseño minimalista en la base.

### Login (`login.tsx`)
- Logo de COSP centrado con espacio generoso.
- Inputs con radio de `16px` y fondo `Slate-100` (Core) o `Slate-800` (Dark).
- Incluir el aviso destacado (Info Box) sobre el número de Legajo.

### Navegación
- **Header:** Indigo-Dark (#312e81) persistente con botón "Salir" en estilo Ghost/Minimal.
- **Bottom Tab Bar:** Fondo `Surface`, iconos de Lucide, etiqueta activa en color primario.

---

## 4. Reglas Técnicas
- **Tecnología:** React Native `StyleSheet` + Expo.
- **Iconografía:** Usar exclusivamente `lucide-react-native` o `@expo/vector-icons`.
- **Localización:** UI en Español (Argentina). Fechas en formato `dd/MM/yyyy`.
- **Lógica:** NO modificar `useAuth`, `useShifts` ni la lógica de `fichadaService`.

---

## 5. Checklist de Validación
- [ ] El cambio de tema afecta a fondos, cards y colores de texto simultáneamente.
- [ ] El botón de GPS (Emerald) es el elemento visual más prominente de la Home.
- [ ] Los radios de las cards son de 16px a 24px, evitando esquinas rectas.
- [ ] La legibilidad es alta en exteriores (contraste mínimo 4.5:1).

**Protocolo:** Si el archivo ya existe, aplica los cambios manteniendo las importaciones de lógica intactas. Si creas componentes nuevos, colócalos en `src/components/ui/`.

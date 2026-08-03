---
name: Dark Ops
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#e29100'
  on-tertiary-container: '#523200'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Chivo
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Chivo
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Chivo
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Chivo
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: Chivo
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  telemetry-data:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1440px
  gutter: 20px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style
The design system is a high-performance, tactical interface designed for mission-critical monitoring and rapid-response environments. It targets technical operators, security professionals, and data analysts who require high legibility in low-light conditions.

The aesthetic merges **Modern Corporate** structure with **Glassmorphism** and **Minimalist** efficiency. It evokes an emotional response of calculated precision, authority, and "always-on" reliability. Surfaces are treated as translucent layers of data, minimizing visual noise to focus strictly on actionable telemetry.

## Colors
This design system utilizes a "Deep Space" palette to ensure maximum contrast for critical indicators.

- **Primary (Emerald):** Reserved strictly for primary actions, success states, and "active" status indicators. It must pierce through the dark background.
- **Secondary (Neon Blue):** Used for telemetry data, secondary links, and information-density highlights.
- **Background & Surface:** The foundation is a deep indigo-charcoal (#0f172a). Surfaces use a translucent Slate (#1e293b) with 70% opacity to create a sense of depth without weight.
- **Status Tones:** Warning states use an amber (#f59e0b) while critical errors utilize a high-vibrancy red (#ef4444).

## Typography
The typography strategy pairs the authoritative, sharp personality of **Chivo** for headings and labels with the technical precision of **JetBrains Mono** for data and body text.

- **Headlines:** Use heavy weights (700+) to establish clear information hierarchy.
- **Labels:** Always uppercase with increased letter spacing to mimic tactical displays.
- **Data Points:** JetBrains Mono ensures that numerical data is perfectly aligned (tabular figures) for quick scanning during rapid telemetry changes.

## Layout & Spacing
The layout follows a **Fluid Grid** model based on a 4px baseline shift. 

- **Desktop:** 12-column grid with 20px gutters. Content is housed in "Modules" that snap to grid increments.
- **Density:** The system prioritizes high information density. Use `md` (16px) spacing for internal card padding and `sm` (8px) for related data groups.
- **Mobile:** Reflows to a 4-column grid. Large data tables should transition to "Snapshot Cards" to maintain legibility.

## Elevation & Depth
Depth in this design system is achieved through **Glassmorphism** and **Tonal Layering** rather than traditional drop shadows.

- **Layer 0 (Base):** Deep indigo (#0f172a) solid.
- **Layer 1 (Cards/Panels):** 70% opacity #1e293b with a `blur(12px)` backdrop filter.
- **Layer 2 (Modals/Popovers):** 85% opacity #1e293b with a `blur(20px)` backdrop filter.
- **Borders:** Every elevated surface must have a 1px "inner glow" border (rgba(148, 163, 184, 0.15)) to define its edges against the dark background. No external shadows are used except for a subtle primary-colored outer glow on active primary buttons.

## Shapes
The shape language is "Soft-Tactical." Use a 0.25rem (4px) radius for most UI components (inputs, buttons, small cards). This maintains a sharp, professional edge while avoiding the aggressive feel of 0px corners.

- **Standard Elements:** 4px radius.
- **Large Containers:** 8px radius (`rounded-lg`).
- **Interactive Indicators:** 2px radius for small status pips or tags.

## Components
- **Primary Buttons:** Solid #10b981 background with #0f172a text. On hover, apply a soft emerald outer glow (0px 0px 12px).
- **Glass Cards:** Semi-transparent containers with 1px subtle borders. Use these for all dashboard widgets.
- **Telemetry Chips:** Use a "ghost" style—1px Neon Blue borders with a 10% opacity blue fill. Text should be JetBrains Mono.
- **Input Fields:** Darker than the background (#020617) with a 1px slate border. The border turns Neon Blue on focus.
- **Status Indicators:** Small circular pips. Active states should use a "breathing" animation (pulsing opacity).
- **Data Tables:** Row-based with 1px bottom borders. No vertical dividers. Use zebra-striping with 2% opacity white for high-density readability.
---
name: COSP Guardia Core
colors:
  surface: '#f9f9ff'
  surface-dim: '#cfdaf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee8ff'
  surface-container-highest: '#d8e3fb'
  on-surface: '#111c2d'
  on-surface-variant: '#464555'
  inverse-surface: '#263143'
  inverse-on-surface: '#ecf1ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#5654a8'
  on-secondary: '#ffffff'
  secondary-container: '#a7a5ff'
  on-secondary-container: '#393689'
  tertiary: '#005338'
  on-tertiary: '#ffffff'
  tertiary-container: '#006e4c'
  on-tertiary-container: '#7df1bd'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#e2dfff'
  secondary-fixed-dim: '#c3c0ff'
  on-secondary-fixed: '#100563'
  on-secondary-fixed-variant: '#3e3c8f'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f9f9ff'
  on-background: '#111c2d'
  surface-variant: '#d8e3fb'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: IBM Plex Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.08em
  button-text:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  container-padding: 16px
  element-gap: 12px
---

## Brand & Style
The design system is engineered for high-stakes operational environments where reliability and clarity are paramount. It adopts a **Modern Corporate** style with **Glassmorphic** accents for information hierarchy. The aesthetic balances the authoritative nature of private security with the efficiency of modern B2B SaaS. 

The UI must evoke a sense of "Command and Control." It uses high-contrast typography and structured depth to ensure that security personnel can navigate the interface under varied lighting conditions (direct sun or night patrols) and while mobile. The visual language is precise, systematic, and intentionally robust.

## Colors
The palette is rooted in the "Command Center" theme. 
- **Indigo Primary/Secondary:** Used for headers, primary actions, and brand identity to establish professionalism.
- **Emerald (Success/Check-in):** Reserved strictly for positive operational confirmations (e.g., "Fichada exitosa").
- **Slate Neutros:** Provides a clean, low-strain background for long shifts and high-readability text.
- **Amber & Rose:** High-visibility colors for alerts and critical notifications.
- **Gradients:** Applied to "Hero" cards (Current Shift, Active Incident) to lift them visually from the standard utility grid.

## Typography
The typography system prioritizes legibility and information density. 
- **Headlines:** Use Hanken Grotesk at heavy weights for clear section delineation. 
- **Labels:** The use of uppercase IBM Plex Sans with high tracking (8%) ensures technical data like "PATENTE" or "HORARIO" is scannable at a glance.
- **Body:** Inter provides a neutral, highly readable experience for report descriptions and logs. 
- **Localization:** All date formats must follow `dd/MM/yyyy` (e.g., 24/05/2024).

## Layout & Spacing
This design system utilizes a **Fluid Grid** optimized for a 390x844 (iPhone 13/14) viewport. 
- **Margins:** A standard 16px side margin is mandatory for all screen edges.
- **Vertical Rhythm:** Elements follow a 4px baseline shift. Components are separated by 12px (md) or 16px (lg) increments to prevent accidental taps.
- **Operational Zones:** Primary action buttons (e.g., "Iniciar Ronda") should be anchored to the bottom of the screen with a safe area of 24px from the home indicator.

## Elevation & Depth
The system uses **Tonal Layers** combined with **Ambient Shadows** to create a structured hierarchy.
- **Level 0 (Background):** Slate-50 (#f8fafc) flat surface.
- **Level 1 (Standard Cards):** White surface with a 1px Slate-200 border and a soft shadow (Y: 4px, Blur: 12px, Opacity: 5% Slate-900).
- **Level 2 (Active States/Hero):** Indigo gradient surfaces with a subtle inner glow (1px top border, 10% white) to simulate a glass effect.
- **Level 3 (Modals/Overlays):** High-diffused shadows (Y: 10px, Blur: 20px, Opacity: 15%) to isolate critical alerts from the operational background.

## Shapes
Shapes are generous and approachable to soften the "hard" nature of security work.
- **Base Components:** 8px radius (Buttons, Inputs).
- **Standard Cards:** 16px radius (List items, Profile cards).
- **Hero Cards:** 24px radius (Main dashboard metrics, QR scanners).
- **Status Indicators:** Fully rounded (Pill) for status chips (e.g., "En Servicio").

## Components
- **Operational Buttons:** Minimum height of **48px** (preferably 56px for primary actions). This accommodates glove use and rapid interaction. Text must be centered with 16px horizontal padding.
- **Data Cards:** Must include a `label-caps` header for data categories. Use 16px internal padding.
- **Status Chips:** Small badges with a background opacity of 15% of their status color (e.g., Amber for "Pendiente") and 100% color for the text/icon.
- **Input Fields:** Outlined style with 1.5px borders. Labels must remain visible (top-aligned) when the field is populated to maintain context.
- **Lists:** Each item must have a minimum touch target height of 64px. Use a chevron-right icon for drill-down navigation.
- **Hero Display:** Gradient-based container at the top of the dashboard containing the guard's name, current sector, and the "Fichar" button.
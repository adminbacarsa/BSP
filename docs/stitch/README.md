# Stitch — Portal del vigilador (COSP Guardia)

Artefactos exportados desde **Google Gemini Stitch** (julio 2026) para el rediseño visual de `apps/mobile-guardia`.

## Contenido

| Archivo | Descripción |
|---------|-------------|
| `prompt_cursor_temas_core_dark_ops.md` | Handoff para Cursor: temas Core + Dark Ops |
| `design-system/cosp-guardia-core.md` | Tokens y guía **Core** (light) |
| `design-system/dark-ops.md` | Tokens y guía **Dark Ops** (dark) |
| `prototypes/*.html` | Mockups HTML (Tailwind) — abrir en navegador |

## Prototipos HTML

| Archivo | Pantalla (título Stitch) |
|---------|--------------------------|
| `01-login-acceso.html` | COSP Guardia - Acceso |
| `02-home-centro-comando.html` | Centro de comando |
| `03-agenda.html` | Agenda |
| `04-novedad.html` | Nueva novedad |
| `05-home-variant-4.html` | Variante home (export 4) |
| `06-home-variant-5.html` | Variante home (export 5) |
| `07-home-variant-6.html` | Variante home (export 6) |

Los HTML usan CDN (Tailwind, fuentes Google); no hace falta build para previsualizar.

## Implementación en código

- Paletas: `apps/mobile-guardia/src/theme/palettes.ts`
- Contexto tema: `apps/mobile-guardia/src/theme/ThemeContext.tsx`
- Selector **Core / Dark Ops**: pantalla **Servicios (Más)** en la app

## Origen local (Notebook)

Export original del usuario:

`C:\Users\Mauro\Downloads\istich\`

Al actualizar diseño en Stitch, volver a copiar aquí y commitear.

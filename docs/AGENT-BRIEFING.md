# COSP V1.0 — Agent Briefing

> **Para agentes IA (Claude Code, Cursor, N8N, etc.)**
> Leé este archivo antes de empezar cualquier tarea en este repo.
> Complementa `CLAUDE.md` (protocolo general) con contexto de estado actual y reglas de colaboración multi-agente.

---

## Instrucción rápida para Cursor / Claude Agent

```text
Leé el archivo docs/AGENT-BRIEFING.md y CLAUDE.md en la raíz del proyecto antes de empezar.
```

---

## 1. Contexto del proyecto

**COSP V1.0** — Sistema de gestión para empresas de seguridad privada.
- **URL producción:** https://comtroldata.web.app
- **Repo GitHub:** https://github.com/adminbacarsa/BSP.git
- **Branch principal:** `main`
- **Stack:** Next.js 14 (static export) + TypeScript + Tailwind CSS + Firebase (Firestore, Auth, Functions)

Ver `CLAUDE.md` para stack completo, colecciones Firestore, módulos y permisos.

---

## 2. Reglas de trabajo (NO negociables)

| Regla | Detalle |
|-------|---------|
| **Idioma** | Responder siempre en **español** |
| **Deploy** | Solo cuando el usuario lo pida explícitamente (`npm run deploy` o `npm run deploy:worktree`) |
| **Commits** | Con múltiples agentes activos: acumular cambios localmente, **no pushear** hasta que el usuario lo ordene |
| **Comentarios** | Solo cuando el WHY es no obvio. Sin comentarios obvios |
| **Archivos .md** | No crear documentación nueva salvo que se pida explícitamente |
| **firestore.rules** | NO tocar salvo que el merge lo traiga y esté revisado |
| **Emuladores** | NO borrar emuladores ni matar `npm run dev` del lab |
| **`.env.local`** | NUNCA commitear |
| **VPLAN** | NO hacer deploy de VPLAN / vplanRun hasta checklist en `docs/VPLAN.md` |

---

## 3. Flujo multi-agente (3 agentes simultáneos)

Este proyecto tiene **hasta 3 agentes IA trabajando en paralelo**. Para evitar conflictos:

1. **Cada agente trabaja en su propia rama** (ej: `cursor/cloud-agent-XXXX`)
2. **No pushear ni commitear sin que el usuario lo pida**
3. **No mergear a `main` directamente** — crear PR y esperar aprobación
4. **Antes de cualquier `git checkout` o `reset`:** ejecutar `git status` y hacer stash si hay cambios

---

## 4. Estado actual del sistema — Modo Capacitación

El módulo **Modo Capacitación** (`apps/web2/src/lib/training/` y `src/components/training/`) es un sistema de onboarding interactivo en la plataforma.

### Componentes principales

| Archivo | Rol |
|---------|-----|
| `apps/web2/src/lib/training/trainingSession.ts` | Define módulos y pasos del circuito |
| `apps/web2/src/lib/training/coachContent.ts` | Instrucciones y hints por paso |
| `apps/web2/src/hooks/useTrainingEvidence.ts` | Detecta completación de pasos en Firestore |
| `apps/web2/src/components/training/TrainingCoachBubble.tsx` | Coach flotante 3 estados |
| `apps/web2/src/components/training/TrainingSpotlight.tsx` | Spotlight sobre el elemento target |
| `apps/web2/src/components/training/TrainingProgressPanel.tsx` | Panel de progreso colapsable |

### Coach — 3 estados

```
expandido  ←→  compacto (barra slim 52px, no molesta)
                  ↕
              lateral (tab en el borde derecho)
```

- **X** en expanded → compacto
- **Minimize2** en expanded → compacto
- **clic en tab lateral** → expandido
- **Auto-reabre** al cambiar de módulo

### Spotlight (`data-action` selectors)

El coach resalta botones usando `data-action` attributes:

| Página | data-action | Paso |
|--------|-------------|------|
| `/admin/crm` | `nuevo-cliente` | crear_cliente |
| `/admin/crm` | `nueva-sede` | crear_sede |
| `/admin/servicios` | `nuevo-servicio` | crear_sla |
| `/admin/rrhh` | `nueva-novedad` | cargar_novedad |
| `/admin/planificacion` | `publicar-cronograma` | publicar_grilla |

El spotlight **persiste en todos los estados del coach** (expandido, compacto, lateral).

### Módulo SERVICES — 3 pasos

```typescript
steps: [
  { id: 'crear_sla',          label: 'Crear contrato/SLA' },
  { id: 'conf_puesto_24hs',   label: 'Puesto 24 horas' },
  { id: 'conf_puesto_custom', label: 'Puesto personalizado' },
]
```

- `conf_puesto_24hs`: detecta posición con `coverageType: '24hs' | '24H' | 'FULL_DAY'`
- `conf_puesto_custom`: detecta servicio con ≥2 posiciones configuradas (`shifts.length > 0`)

### Instrucciones del coach — convenciones

- Referencias genéricas: "el cliente de práctica que aparece en la lista (ej: Fábrica Demo SRL)"
- **NO** hardcodear nombres como "Banco del Sur SA" o "Sucursal Centro"
- Usar `\n` para saltos de línea (se renderiza como `<br />`)
- Listas numeradas con `1. 2. 3.`

---

## 5. Deploy rápido

```bash
# Con lab corriendo (recomendado — usa worktree en ../cronoapp-deploy)
npm run deploy:worktree

# Forzar build en esta carpeta (lab apagado)
npm run deploy:here
```

**NUNCA** `firebase deploy` directo sin usar el script — puede tumbar el lab.

---

## 6. Qué NO tocar

- `useOperacionesMonitor.ts` — lógica de operaciones en tiempo real, muy compleja
- `firestore.rules` — reglas de seguridad
- `planificacion_estados` — colección que controla qué planificación está publicada
- `apps/functions/src/vplan/` — código VPLAN experimental, sin deploy hasta sign-off

---

## 7. Cómo correr el lab

```bash
# 1. Emuladores (Firestore + Auth + Functions)
npm run emulators

# 2. Seed (admin@bacarsa.com.ar / admin1234)
npm run seed

# 3. Dev server (http://localhost:3001)
npm run dev
```

Diagnóstico: `npm run diagnose:lab`

---

*Última actualización: 2026-09-18*

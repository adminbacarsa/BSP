# COSP V1.0 — Agent Briefing

> **Para agentes IA (Claude Code, Cursor Cloud Agent, N8N, etc.)**
> Leé este archivo + `CLAUDE.md` antes de cualquier tarea. Este briefing no duplica CLAUDE.md — lo complementa con estado actual, mobile y reglas de equipo.

---

## Instrucción de carga para Cursor / Claude Agent

```text
Leé los archivos docs/AGENT-BRIEFING.md y CLAUDE.md en la raíz del proyecto antes de empezar.
Son el protocolo del equipo y el estado actual del sistema.
```

---

## 1. Qué es COSP y el stack

**COSP V1.0** — Sistema operativo para empresas de seguridad privada (turnos, guardias, CRM, RRHH, liquidación).

| Capa | Tecnología | Carpeta |
|------|-----------|---------|
| Panel web admin | Next.js 14 static export + TS + Tailwind | `apps/web2/` |
| Backend | Firebase Functions (NestJS, Node 22) | `apps/functions/` |
| Base de datos | Firestore (colecciones: turnos, empleados, servicios_sla, …) | Firebase |
| Auth | Firebase Auth | Firebase |
| App nativa guardia | Expo (React Native) — **solo Android v1** | `apps/mobile-guardia/` |
| Paquetes compartidos | Portal-core (web ↔ app) | `packages/portal-core/` |
| Hosting | Firebase Hosting | `comtroldata.web.app` |

Ver `CLAUDE.md §2–4` para colecciones Firestore, módulos, códigos de turno y lógica de retención.

---

## 2. Ramas y flujo de trabajo

```
NOTEBOOK (C:\APP\cronoapp)
  └─ Desarrollo principal + commits + deploys a producción

RAMAS DE AGENTE
  cursor/cloud-agent-XXXXXXX   ← cada agente Cursor Cloud tiene su rama
  main                         ← rama principal (PR review antes de mergear)

TESTING (N8N — 192.168.0.8, B:\cronoapp)
  git fetch origin && git reset --hard origin/main

PRODUCCIÓN
  npm run deploy:worktree   ← SIEMPRE usar esto, nunca firebase deploy directo
  URL: https://comtroldata.web.app
```

### Reglas de commit/push

- **Con varios agentes activos:** NO pushear en cada cambio. Acumular y pushear solo cuando el usuario lo pida.
- **Siempre una rama por agente.** Nunca commitear directo a `main`.
- **No crear PRs** sin que el usuario lo pida.
- **No hacer deploy** salvo que el usuario diga "deploy", "subí" o nombre explícitamente producción.

---

## 3. Reglas de trabajo (NO negociables)

| Regla | Detalle |
|-------|---------|
| **Idioma** | Responder siempre en **español** |
| **Deploy** | Solo explícito. Comando: `npm run deploy:worktree` |
| **Commits** | Con múltiples agentes: acumular, no pushear solo |
| **Comentarios** | Solo WHY no obvio. Sin comentarios descriptivos |
| **Archivos .md** | No crear documentación salvo pedido explícito |
| **firestore.rules** | NO tocar salvo merge revisado |
| **Emuladores** | NO matar emuladores ni `npm run dev` del lab |
| **`.env.local`** | NUNCA commitear |
| **VPLAN** | NO deployar `vplanRun` hasta checklist en `docs/VPLAN.md` |

---

## 4. Qué NO tocar

| Archivo / carpeta | Razón |
|-------------------|-------|
| `useOperacionesMonitor.ts` | Lógica de ops en tiempo real, muy compleja, alto riesgo |
| `firestore.rules` | Reglas de seguridad — cambio incorrecto bloquea usuarios |
| `planificacion_estados` (colección) | Controla qué planificación es visible; borrar = pérdida de datos |
| `apps/functions/src/vplan/` | VPLAN experimental — sin deploy hasta sign-off |
| `apps/web2/.env.local` | Credenciales — jamás al repo |

---

## 5. App nativa portal guardia (mobile-guardia)

**Tecnología:** Expo SDK 52, React Native, Android-only v1.  
**Backend:** mismo Firebase `comtroldata`.  
**Carpeta:** `apps/mobile-guardia/` + `packages/portal-core/`.

### Canales EAS

| Canal | Uso | Qué recibe |
|-------|-----|------------|
| `production` | APK en Google Play (testers internos) | OTA updates automáticas |
| `preview` | APK de desarrollo / QA manual | OTA updates automáticas |

> **APK en Play Store = canal `production`.** Para enviar OTA a producción:
> ```bash
> eas update --channel production --message "descripción"
> ```
> Para preview:
> ```bash
> eas update --channel preview --message "descripción"
> ```

### Estado actual (2026-09-18)

| Fase | Nombre | Estado |
|------|--------|--------|
| F0 | Fundación | EN_CURSO (8/12) |
| F1 | Auth, activación y turnos | **COMPLETA** |
| F2 | Fichada con GPS | EN_CURSO (8/10) |
| F3 | Ausencias, licencias y push | EN_CURSO (11/12) |
| F4 | Permutas de turno | EN_CURSO (7/8) |
| F5 | Credencial digital y UX | **COMPLETA** |
| F6 | Beta cerrada y hardening | EN_CURSO (0/9) |
| F7 | Publicación en Google Play | PENDIENTE |

**Próximas tareas prioritarias:**
- `F6-01` — Play Internal Testing (crear app + AAB + testers)
- `F0-11` — Política de privacidad (URL pública para Data Safety)

**iOS:** descartado en v1. El código Expo es multiplataforma pero no se construye ni publica IPA.

**Módulos recientes en la rama `cursor/cloud-agent-*`:**
- Portal ausencias y alertas
- Portal agenda de turnos
- OTA enviada al canal `production`

Ver estado completo en `docs/MOBILE-GUARDIA-IMPLEMENTACION.md`.

---

## 6. Estado actual — Panel web (Modo Capacitación)

El módulo de onboarding interactivo está en `apps/web2/src/lib/training/` y `src/components/training/`.

**Coach flotante:** 3 estados (expandido → compacto → tab lateral). Se auto-minimiza al hacer clic en el botón resaltado por el spotlight, y se auto-expande al avanzar de paso.

**Pasos de práctica:** cada módulo termina con un ejercicio libre (`stepId: 'practica'`) donde el alumno trabaja sin guía y confirma manualmente.

**data-action selectors para spotlight:**

| Ruta | `data-action` | Paso |
|------|---------------|------|
| `/admin/crm` | `nuevo-cliente` | crear_cliente |
| `/admin/crm` | `nueva-sede` | crear_objetivo |
| `/admin/servicios` | `nuevo-servicio` | crear_sla |
| `/admin/rrhh` | `nueva-novedad` | cargar_novedad |
| `/admin/planificacion` | `publicar-cronograma` | publicar_grilla |

---

## 7. Lab local (desarrollo)

```bash
npm run emulators   # Firestore + Auth + Functions (puerto 8080/9099/5001/4000)
npm run seed        # Crea admin@bacarsa.com.ar / admin1234 + guardia@bacarsa.com.ar / guardia1234
npm run dev         # Next.js en http://localhost:3001
npm run diagnose:lab  # Diagnóstico si algo no levanta
```

---

## 8. Deploy

```bash
# Panel web (con lab activo — worktree aislado)
npm run deploy:worktree

# Panel web (lab apagado)
npm run deploy:here

# Functions específica
firebase deploy --only functions:chatPlatformAssistant

# App nativa — OTA a producción
eas update --channel production --message "fix: descripcion"
```

---

*Última actualización: 2026-09-18 | Rama: cursor/cloud-agent-1789165375719-scvyk*

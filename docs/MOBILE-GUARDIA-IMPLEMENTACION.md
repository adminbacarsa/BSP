# App nativa Portal Guardia — Plan e implementación

> **Versión del plan:** 1.1  
> **Inicio:** 2026-07-28  
> **Estado global:** `EN_CURSO` — validación Android + beta Play  
> **Alcance v1:** App nativa **solo Android** (APK preview → Google Play). Portal web en paralelo (`/empleado/*`).  
> **Fuera de alcance v1:** **iOS** (Apple Developer, APNs, TestFlight, App Store) — descartado hasta nuevo aviso.  
> **Backend:** Mismo Firebase (`comtroldata`) — Auth, Firestore, Functions, Storage, FCM.

---

## Cómo usar este documento

1. **Al terminar una tarea:** marcar `[x]` en la tarea, completar la fila en la tabla de la tarea (`Estado`, `Fecha`) y agregar una entrada en la **Bitácora** (abajo).
2. **Al completar todas las tareas de una fase:** cambiar el estado de la fase a `COMPLETA` en el **Panel de estado**, registrar en bitácora y revisar el checklist de cierre de fase.
3. **Referencia en commits:** usar el ID de tarea, ej. `mobile(F0-03): registrar app Android en Firebase`.
4. **En chat con el agente:** indicar «marcá F2-04 como completa en MOBILE-GUARDIA-IMPLEMENTACION.md».

---

## Panel de estado (actualizar siempre)

| Fase | Nombre | Estado | Tareas | Progreso | Completada |
|------|--------|--------|--------|----------|------------|
| **F0** | Fundación | `EN_CURSO` | 12 | 8/12 | — |
| **F1** | Auth, activación y turnos | `EN_CURSO` | 14 | 13/14 | — |
| **F2** | Fichada con GPS | `EN_CURSO` | 10 | 8/10 | — |
| **F3** | Ausencias, licencias y push | `EN_CURSO` | 12 | 11/12 | — |
| **F4** | Permutas de turno | `EN_CURSO` | 8 | 7/8 | — |
| **F5** | Credencial digital y UX | `EN_CURSO` | 10 | 9/10 | F5-09 en validación |
| **F6** | Beta cerrada y hardening | `PENDIENTE` | 10 | 0/9* | — |
| **F7** | Publicación en stores | `PENDIENTE` | 12 | 0/6* | — |
| | **TOTAL activo (sin iOS)** | | **88** | **36/79*** | |

\*Tareas iOS marcadas **DESCARTADO v1** (no cuentan para cierre de fase).  
**Fase activa recomendada:** F1-14 E2E activación → F5-09 pantallas → F6 beta Play. **F4-08 permutas aplazado.**  
**Última actualización:** 2026-08-22  
**Última tarea completada:** F3-12 FCM Android + Eventos EV validados en dispositivo; mail dual-link deploy

---

## Qué falta ahora

> Sección de lectura rápida. Actualizar al cerrar cada tarea.

### Hecho esta semana (no reabrir salvo regresión)

- APK **1.1.3** + OTA preview (Alertas filtradas, Me enteré/Quitar/Borrar todas, filtros 1 fila, sin turnos no publicados, mes cronograma AR, FCM preview por legajo).
- **Eventos EV** ✅ validados en dispositivo (convocatoria + asignación Planificación + notif).
- **F3-12 FCM Android** ✅ push con app abierta/cerrada + Probar FCM panel.
- Push cronograma/cambio turno con `notification` + acuse en Firestore (`ackedAt`).
- Mail activación dual-link (app + web); banner web «Abrir en COSP Guardia».
- **OTA preview** «F5-09 responsive + F1 activar/device-blocked» (grupo `2981945d-…`).

### Próxima tarea (prioridad)

| ID | Tarea | Fase |
|----|-------|------|
| **F1-14** | E2E activación + device block en APK físico | F1 |
| **F5-09** | Revisión 3 tamaños de pantalla | F5 |
| **F3-12** | ✅ FCM Android validado (2026-08-22) | F3 |
| **Eventos EV** | ✅ Validado con vigilador (2026-08-22) | Pre-F4 |
| **F4-08** | Permutas E2E — **PAUSADO** | F4 |

### Aplazado / descartado (no bloquea APK Android)

| ID | Motivo |
|----|--------|
| **F4-08** E2E permutas | Autorización supervisor vive en web/planificación; se retoma con app/flujo supervisores. Código `/permutas` ya existe. |
| **iOS (v1)** | F0-02, F0-04, F3-06, F6-02, F7-02, F7-04, F7-06, F7-09, F7-11 — **descartado** hasta definir Apple Developer + prioridad App Store. El código Expo sigue siendo multiplataforma; no se construye ni publica IPA. |

### Bloqueantes / fundación aún abiertos (solo Android)

- **F0-01** Google Play Console (cuenta desarrollador).
- **F0-11** Política de privacidad (URL pública; Data Safety Play).
- **F6** beta Android: Internal Testing, hardening, pilotos (F6-02 TestFlight **no aplica**).
- **F7** publicación **Google Play** (F7-03, F7-05, F7-07 parcial Google, F7-08 Google, F7-10, F7-12).
- Paridad doc: varias filas web↔app siguen ⬜ aunque el código exista — **marcar tareas al validar en dispositivo**.

### Paridad web ↔ app (resumen)

| Módulo | Web | App | Fase |
|--------|-----|-----|------|
| Activación dispositivo | ✅ | ⬜ | F1 |
| Login / logout | ✅ | ⬜ | F1 |
| Turnos / agenda | ✅ | ⬜ | F1 |
| Fichada GPS | ✅ | ⬜ | F2 |
| Cola offline fichadas | ✅ | ⬜ | F2 |
| Llegada tarde | ✅ | ⬜ | F3 |
| Ausencias + adjuntos | ✅ | ⬜ | F3 |
| Licencias | ✅ | ⬜ | F3 |
| Push notifications | ✅ (web) | ✅ Android | F3 |
| Permutas | ✅ | ✅ | F4 |
| Eventos EV (convocatoria / solicitud) | ✅ | ✅ | Pre-F4 |
| Credencial digital | ✅ | ✅ | F5 |
| Flags `portalFeatures` | ✅ | ⬜ | F1 |

---

## Bitácora de avances

> Entradas más recientes arriba. Una línea por tarea o hito de fase.

```
2026-08-22 | F3-12+EV OK | Mauro validó FCM Android y Eventos EV en dispositivo; deploy createPortalAccess (mail app+web) + hosting activar
2026-08-22 | F1-04 activación app | Mail dual-link (cosp-guardia + web); intentFilters Android; assetlinks template; banner web activar
2026-08-22 | Alcance v1 Android | iOS descartado del plan activo (F0-02/04, F3-06, F6-02, F7 iOS); F3-12 = solo Android; objetivo F7 = Google Play
2026-08-21 | Acuse+F3-12 prep | Panel Planificación muestra Enterado/Pendiente Me enteré + Probar FCM por legajo; sendTestNotification acepta employeeId (SuperAdmin); checklists Eventos/F3-12 actualizados; F4-08 pausado
2026-08-21 | Turnos portal | App oculta draft y planificación sin publishedAt; solo operativos/EV sin publicar
2026-08-21 | Alertas guardia | Filtro solo tipos empleado (oculta Vacante/ops); preview sin uid admin; Me enteré + Quitar (soft); FCM turno/cronograma con notification+requiresAck
2026-08-20 | Eventos+FCM prep | Acepto/No puedo en Hoy; asEmployeeId preview; solicitudes onSnapshot; FCM test en Alertas (prod); F4-08 aplazado (supervisores); v1.1.2
2026-08-20 | UX-2/3+OTA | Hoy chip alertas; Alertas filtros dominio; expo-updates + Más «Buscar actualización»; v1.1.0 canal preview; AppUpdateBootstrap
2026-08-20 | UX-1 | Agenda calendario Día/Semana/Mes (default Mes); Cliente·Objetivo·Puesto; nav período; useEmployeeShifts por mes
2026-08-20 | UX-0 | Bottom tabs Hoy·Agenda·Alertas·Más; resolveShiftPlacement (Cliente·Objetivo·Puesto); tab Alertas + deep links FCM; Agenda default Mes (calendario = UX-1)
2026-08-19 | Eventos EV | App /eventos, convocatorias Acepto/No puedo, solicitud cupo, inbox normalizado, firestore.rules empleado, notif convocatoria title/body/employeeId
2026-08-22 | F5-09 | useResponsiveLayout + login/activar/device-blocked/hero/index OTA preview
2026-08-04 | F4-08 prep | seed-swap-peer + checklist E2E permutas
2026-08-04 | F5-05/06 | Banner sin conexión, PortalErrorPanel, novedad temática, LoadingScreen
2026-08-03 | F5-01..04 | Credencial digital: QR, código 60s, foto cámara, cache AsyncStorage
2026-08-03 | F4 | Permutas app + callables swap + supervisor en planificación
2026-08-03 | UI Stitch | Temas Core/Dark Ops + docs/stitch (Gemini Stitch export)
2026-07-31 | F3-03/04 | Certificado en /novedad — cámara/galería, upload Storage absences/{uid}
2026-07-30 | F3-01/02 | Pantalla /novedad — ausencias y licencias (Firestore ausencias, classifyAbsence)
2026-07-30 | F2-05 | CheckInStatusBanner + resolveCheckInUiStatus en portal-core
2026-07-30 | F1-14 | seed-empleado crea turno demo del día (Planta Bacar Lab) para app móvil
2026-07-30 | F1-01..F1-13 | Login, activación, deviceId, home/agenda turnos (onSnapshot), portalFeatures, logout
2026-07-30 | F0-10 | Smoke test validado en dispositivo/web (Metro monorepo aislado)
2026-07-28 | F0-12 | .env.example en apps/mobile-guardia
2026-07-28 | F0-10 | Pantalla smoke test COSP Guardia + health Firebase
2026-07-28 | F0-09 | eas.json preview/production
2026-07-28 | F0-08 | Workspaces npm + scripts dev:mobile en raíz
2026-07-28 | F0-07 | packages/portal-core (Firebase, callables, resolveEmpDocId)
2026-07-28 | F0-06 | packages/portal-types (Shift, PortalFeatures, etc.)
2026-07-28 | F0-05 | apps/mobile-guardia Expo 57 + Expo Router
```

---

## Arquitectura de referencia

```
apps/web2/              ← Portal web (se mantiene)
apps/mobile-guardia/    ← App nativa Expo (nuevo)
packages/portal-types/  ← Tipos compartidos
packages/portal-core/   ← Lógica Firebase + callables compartida
apps/functions/         ← Backend existente (ajustes menores)
```

**Stack móvil:** Expo + React Native + TypeScript + Expo Router  
**Identificador sugerido:** `com.grupobacar.cosp.guardia`

---

# FASE 0 — Fundación

**Objetivo:** Proyecto listo para desarrollar sin impacto en producción web.  
**Estado:** `EN_CURSO`  
**Duración estimada:** 2 semanas

### Checklist de cierre de fase

- [ ] Las 12 tareas F0 marcadas como hechas (7/12)
- [ ] Build Android `preview` instalable en dispositivo físico
- [ ] Conexión a emulador Firebase verificada en dispositivo
- [ ] Bitácora actualizada con `F0 COMPLETA`
- [ ] Panel de estado: F0 = `COMPLETA`, F1 = `EN_CURSO`

### Arranque local (dev)

```powershell
npm install --prefix packages/portal-core --ignore-scripts
npm install --prefix apps/mobile-guardia --ignore-scripts
copy apps\mobile-guardia\.env.example apps\mobile-guardia\.env
# Completar .env con las mismas keys que apps/web2/.env.local
npm run dev:mobile
```

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F0-01 | Cuenta Google Play Console | Cuenta activa, perfil de desarrollador completado | ⬜ Pendiente | — |
| F0-02 | Cuenta Apple Developer Program | Membresía activa (USD 99/año) | ⏸ Descartado v1 | — |
| F0-03 | App Android en Firebase Console | `google-services.json` descargado; package `com.grupobacar.cosp.guardia` | ✅ Hecha | 2026-08-20 |
| F0-04 | App iOS en Firebase Console | `GoogleService-Info.plist` descargado; bundle ID definido | ⏸ Descartado v1 | — |
| F0-05 | Crear `apps/mobile-guardia` | Expo SDK actual, TypeScript, Expo Router, arranca en simulador | ✅ Hecha | 2026-07-28 |
| F0-06 | Crear `packages/portal-types` | Tipos `Shift`, `PortalFeatures`, `ObjectiveLocation`, `EmpleadoPortal` | ✅ Hecha | 2026-07-28 |
| F0-07 | Crear `packages/portal-core` | Cliente Firebase (prod + emulador), wrappers callables base | ✅ Hecha | 2026-07-28 |
| F0-08 | Workspaces npm en monorepo | `package.json` raíz resuelve `apps/mobile-guardia` y `packages/*` | ✅ Hecha | 2026-07-28 |
| F0-09 | Configurar EAS Build | `eas.json` con profile `preview` (APK) y `production` | ✅ Hecha | 2026-07-28 |
| F0-10 | Pantalla smoke test | App muestra "COSP Guardia" y estado Firebase/emulador | ✅ Hecha | 2026-07-28 |
| F0-11 | Política de privacidad (URL pública) | URL accesible para stores; menciona ubicación, fotos, dispositivo | ⬜ Pendiente | — |
| F0-12 | Documentar variables de entorno móvil | `.env.example` en `mobile-guardia` con keys Firebase públicas | ✅ Hecha | 2026-07-28 |

---

# FASE 1 — Auth, activación y turnos

**Objetivo:** Guardia entra, activa dispositivo y ve sus turnos en tiempo real.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 3 semanas  
**Depende de:** F0 completa

### Checklist de cierre de fase

- [ ] Las 14 tareas F1 marcadas como hechas
- [ ] Flujo activación → login → home probado en Android
- [ ] Deep link de activación abre la app
- [ ] Bloqueo por `deviceId` funciona igual que web
- [ ] Web `/empleado/*` sin regresiones
- [ ] Bitácora: `F1 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F1-01 | Pantalla Splash + routing auth | Redirige a login o home según sesión | ✅ Hecha | 2026-07-30 |
| F1-02 | Pantalla Login | `signInWithEmailAndPassword`; manejo de errores | ✅ Hecha | 2026-07-30 |
| F1-03 | Pantalla Activación | Llama `activateAndSetPassword`; auto-login post activación | ✅ Hecha | 2026-07-30 |
| F1-04 | Deep links / App Links activación | Scheme `cosp-guardia://` + intentFilters HTTPS; mail dual-link; `assetlinks.json` (pendiente SHA EAS) | 🔄 Parcial | 2026-08-22 |
| F1-05 | Persistencia `deviceId` | SecureStore/Keychain; reemplaza `localStorage` | ✅ Hecha | 2026-07-30 |
| F1-06 | Verificación dispositivo | Pantalla bloqueo si `deviceId` ≠ dispositivo actual | ✅ Hecha | 2026-07-30 |
| F1-07 | Backend: campo `platform` | Functions guardan `ios`/`android`/`web` en activación | ✅ Hecha | 2026-07-30 |
| F1-08 | `resolveEmpDocId` en portal-core | Misma lógica que `dashboard.tsx` (uid, email) | ✅ Hecha | 2026-07-30 |
| F1-09 | Listener turnos Firestore | `onSnapshot` turnos del empleado; tiempo real | ✅ Hecha | 2026-07-30 |
| F1-10 | UI Home — turno de hoy | Card principal con turno activo, objetivo, horarios | ✅ Hecha | 2026-08-22 |
| F1-11 | UI Agenda semana/mes | Lista histórica y próximos turnos | ✅ Hecha | 2026-08-20 |
| F1-12 | Lectura `portalFeatures` | Ocultar módulos deshabilitados por empresa | ✅ Hecha | 2026-07-30 |
| F1-13 | Logout | `signOut` + limpieza estado local | ✅ Hecha | 2026-08-22 |
| F1-14 | Prueba E2E emulador / APK | Activar guardia → ver turno; segundo device bloqueado | ⬜ Pendiente | — |

---

# FASE 2 — Fichada con GPS

**Objetivo:** Check-in operativo con geolocalización y cola offline.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2 semanas  
**Depende de:** F1 completa

### Checklist de cierre de fase

- [ ] Las 10 tareas F2 marcadas como hechas
- [ ] Fichada visible en Operaciones igual que desde web
- [ ] Cola offline sincroniza al recuperar red
- [ ] Bitácora: `F2 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F2-01 | Permisos ubicación (runtime) | `expo-location`; strings iOS/Android justificados | ✅ Hecha | 2026-07-30 |
| F2-02 | Obtener coordenadas | `getCurrentPosition` con timeout y error UX | ✅ Hecha | 2026-07-30 |
| F2-03 | Validación distancia objetivo | Misma lógica radio + `allowRemoteCheckIn` que web | ✅ Hecha | 2026-07-30 |
| F2-04 | Integrar `requestCheckIn` | Callable con shiftId, lat, lng, deviceId | ✅ Hecha | 2026-07-30 |
| F2-05 | Estados UI fichada | Pendiente / confirmado / tarde / rechazado | ✅ Hecha | 2026-07-30 |
| F2-06 | Cola offline en portal-core | Portar `PENDING_CHECKINS_KEY` a AsyncStorage | ✅ Hecha | 2026-07-30 |
| F2-07 | Sync automático al reconectar | Reintento fichadas pendientes en background | ✅ Hecha | 2026-07-30 |
| F2-08 | Refactor web (opcional) | Web usa `portal-core` para fichada si conviene | ⬜ Pendiente | — |
| F2-09 | Prueba dispositivo real | Fichada en objetivo de prueba con GPS real | ⬜ Pendiente | — |
| F2-10 | Documentar permisos para stores | Textos finales para **Google Play** (Data Safety / permisos GPS, cámara, notif) | ⬜ Pendiente | — |

---

# FASE 3 — Ausencias, licencias y notificaciones

**Objetivo:** Novedades RRHH y alertas push nativas.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 3 semanas  
**Depende de:** F2 completa

### Checklist de cierre de fase

- [ ] Las 12 tareas F3 marcadas como hechas
- [ ] Ausencia con adjunto llega a Firestore + Storage
- [ ] Push funciona en **Android** (build EAS preview/prod)
- [ ] Bitácora: `F3 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F3-01 | Formulario reportar ausencia | Mismos campos que web → colección `ausencias` | ✅ Hecha | 2026-07-30 |
| F3-02 | Formulario solicitar licencia | Flujo separado o unificado según web | ✅ Hecha | 2026-07-30 |
| F3-03 | Adjunto certificado (cámara) | `expo-image-picker` → Storage `absences/{uid}/` | ✅ Hecha | 2026-07-31 |
| F3-04 | Adjunto certificado (galería) | Galería en `CertificateAttachmentField` | ✅ Hecha | 2026-07-31 |
| F3-05 | `notificarLlegadaTarde` | Botón y confirmación; estado en UI | ✅ Hecha | 2026-07-30 |
| F3-06 | Configurar APNs en Firebase | Key/cert Apple para push iOS | ⏸ Descartado v1 | — |
| F3-07 | `expo-notifications` + FCM | Permisos push; token al login | ✅ Hecha | 2026-08-03 |
| F3-08 | Registrar token en backend | Doc `device_tokens` (id = token FCM) | ✅ Hecha | 2026-08-03 |
| F3-09 | Centro notificaciones in-app | Listener `user_notifications` | ✅ Hecha | 2026-08-03 |
| F3-10 | Push en foreground | Alert al recibir con app abierta | ✅ Hecha | 2026-08-03 |
| F3-11 | `sendTestNotification` en app | Botón en Servicios (Más) | ✅ Hecha | 2026-08-03 |
| F3-12 | Prueba push Android (build EAS) | FCM con app abierta y cerrada; token en `device_tokens` | ✅ Hecha | 2026-08-22 |

---

# FASE 4 — Permutas de turno

**Objetivo:** Paridad con módulo swap del portal web.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2 semanas  
**Depende de:** F3 completa

### Checklist de cierre de fase

- [ ] Las 8 tareas F4 marcadas como hechas
- [ ] Permuta end-to-end (app ↔ web cross-client)
- [ ] Bitácora: `F4 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F4-01 | UI listado permutas | Pantalla `/permutas` + listener | ✅ Hecha | 2026-08-03 |
| F4-02 | Buscar compañero | `getSwapPeople` + candidatos por turno | ✅ Hecha | 2026-08-03 |
| F4-03 | Candidatos de turno | `getSwapCandidates` | ✅ Hecha | 2026-08-03 |
| F4-04 | Crear solicitud | `createSwapRequest` | ✅ Hecha | 2026-08-03 |
| F4-05 | Responder solicitud | `respondSwapRequest` (aceptar/rechazar) | ✅ Hecha | 2026-08-03 |
| F4-06 | Confirmar / cancelar | `confirmSwapRequest` → `PENDING_SUPERVISOR` | ✅ Hecha | 2026-08-03 |
| F4-07 | Notificación de permuta | `user_notifications` en cada paso | ✅ Hecha | 2026-08-03 |
| F4-08 | Prueba E2E permuta | Dos guardias + supervisor (`approveSwapRequest`) | ⬜ Pendiente | — |

### Checklist E2E Eventos EV (Paso 0.5) — producción / APK

**Preferir login vigilador real** (APK ≥ 1.1.3 + OTA). Preview SuperAdmin solo como respaldo.

1. **Admin** — Servicios → Eventos → Convocar al legajo de prueba.
2. **App** — Login de ese legajo → Hoy → **Acepto** (o Más → Eventos).
3. Verificar: solicitud `aprobada`; turno **EV** en Hoy/Agenda; alerta «Evento confirmado».
4. **Me enteré** en Alertas.
5. **Panel** — Planificación → Actividad → Notificaciones: fila del legajo en **✓ Enterado**.
6. Opcional: otra convocatoria → **No puedo** → `rechazada`.

**Criterio OK:** Acepto sin error; EV visible; push/bandeja; acuse en panel.

**Estado:** ✅ Validado 2026-08-22 (Mauro).

**Nota preview:** `asEmployeeId` OK; FCM al admin solo si reentrás al preview. Solicitar cupo en preview bloqueado.

### Checklist E2E F3-12 (FCM) — APK preview/prod **Android**

1. APK ≥ **1.1.3**, login **vigilador real**, notificaciones ON.
2. App abierta → Alertas → **Probar push** → OK in-app.
3. **App cerrada** (quitar de recientes) → Planificación → Actividad → Notificaciones → **Probar FCM** en una fila de ese legajo (SuperAdmin). Alternativa: republicar cronograma / cambiar turno / asignar EV.
4. Notificación del **sistema** Android (canal COSP Guardia).
5. Tocá → deep link razonable.

**Criterio OK:** push con app cerrada; token en `device_tokens` con `employeeId`/`uid` del vigilador. *(iOS fuera de alcance v1.)*

**Estado:** ✅ Validado 2026-08-22 (Mauro, APK preview Android).

### Checklist E2E F4-08 (lab) — PAUSADO

> **Estado:** aplazado hasta app/flujo de supervisores. El código de permutas del guardia (`/permutas`) permanece; no es requisito del próximo APK.  
> **Antes de retomar:** validar **Paso 0.5 Eventos**.

**Preparación (emulador)** — cuando se retome:

1. `npm run emulators` + `npm run dev` (web `:3001`) + `npm run dev:mobile` (Expo).
2. `npm run seed` luego `npm run seed:swap-peer` (Guardia A hoy + Guardia B mañana, mismo `obj_lab_guardia`).
3. Móvil `.env` con `EXPO_PUBLIC_USE_EMULATOR=true` y misma IP que `web2` si no es localhost.

**Actores**

| Rol | Credenciales lab |
|-----|------------------|
| Solicitante (app) | `guardia@bacarsa.com.ar` / `guardia1234` |
| Compañero (web o app) | `guardia2@bacarsa.com.ar` / `guardia1234` |
| Supervisor | `admin@bacarsa.com.ar` / `admin1234` → empresa Bacar |

**Pasos**

1. **App** — Login Guardia A → Permutas → elegir turno hoy → candidato María (mañana) → Enviar.
2. **Web** — Login Guardia B → dashboard → aceptar permuta (`PENDING_PEER`).
3. **App** — Guardia A → Confirmar permuta → estado `PENDING_SUPERVISOR`.
4. **Web admin** — Planificación → banner ámbar «Permutas pendientes» → **Autorizar**.
5. **Verificación Firestore** — En `turnos`, los dos `seed_shift_*` deben tener `employeeId` cruzado, `isSwap: true`, `swapAuthorized: true`.
6. **Opcional cross-client** — Repetir paso 2 en app (Guardia B) o paso 1 en web (Guardia A).

**Criterio de aprobación Paso 1 roadmap:** los 5 pasos sin error; bitácora + marcar F4-08 y F4 COMPLETA.

---

# FASE 5 — Credencial digital y pulido UX

**Objetivo:** Credencial usable + app lista para beta externa.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2 semanas  
**Depende de:** F4 completa

### Checklist de cierre de fase

- [ ] Las 10 tareas F5 marcadas como hechas
- [ ] Design system alineado con web (indigo/emerald, rounded-2xl)
- [ ] Bitácora: `F5 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F5-01 | Pantalla credencial | Foto, nombre, legajo, DNI, empresa | ✅ Hecha | 2026-08-03 |
| F5-02 | QR de credencial | `react-native-qrcode-svg`; mismo payload que web | ✅ Hecha | 2026-08-03 |
| F5-03 | Actualizar foto legajo | Cámara → Storage → doc empleado | ✅ Hecha | 2026-08-03 |
| F5-04 | Cache offline credencial | AsyncStorage última versión | ✅ Hecha | 2026-08-03 |
| F5-05 | Pantallas error / sin conexión | Banner offline + PortalErrorPanel | ✅ Hecha | 2026-08-04 |
| F5-06 | Loading states globales | LoadingScreen temático + ActivityIndicator | ✅ Hecha | 2026-08-04 |
| F5-07 | Icono y splash app | Assets para dev y stores (1024 icon) | ✅ Hecha | 2026-08-20 |
| F5-08 | Accesibilidad básica | Tamaños táctiles, contraste, labels | ✅ Hecha | 2026-08-20 |
| F5-09 | Revisión en 3 tamaños pantalla | Phone pequeño, estándar, tablet | 🟡 En validación | OTA 2026-08-22; tab Más local pendiente OTA |
| F5-10 | Manual guardia (borrador) | Guía instalación app (complementa tutorial web) | ✅ Hecha | 2026-08-20 |

---

# FASE 6 — Beta cerrada y hardening

**Objetivo:** Validación con guardias reales; estabilidad pre-producción.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2 semanas  
**Depende de:** F5 completa

### Checklist de cierre de fase

- [ ] Las tareas F6 **activas** marcadas como hechas (F6-02 TestFlight no aplica)
- [ ] 2 semanas piloto sin incidentes P0
- [ ] Bitácora: `F6 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F6-01 | Play Internal Testing | Track interno; 10+ testers invitados | ⬜ Pendiente | — |
| F6-02 | TestFlight iOS | Build subido; testers externos | ⏸ Descartado v1 | — |
| F6-03 | Crashlytics o Sentry | Errores JS y nativos reportados | ⬜ Pendiente | — |
| F6-04 | Revisión `firestore.rules` | Rol employee puede operar desde app | ⬜ Pendiente | — |
| F6-05 | Auditoría secrets en bundle | Sin keys privadas en APK/IPA | ⬜ Pendiente | — |
| F6-06 | Lista bugs piloto | Issues GitHub priorizados P0/P1/P2 | ⬜ Pendiente | — |
| F6-07 | Fix bugs P0 | Cero bugs críticos abiertos | ⬜ Pendiente | — |
| F6-08 | Guía RRHH activación app | Cómo generar link; app vs web | ⬜ Pendiente | — |
| F6-09 | Comunicación a guardias piloto | Email/WhatsApp con instrucciones | ⬜ Pendiente | — |
| F6-10 | Sign-off stakeholders | Aprobación Mauro / operaciones para stores | ⬜ Pendiente | — |

---

# FASE 7 — Publicación en stores

**Objetivo:** App en **Google Play** en producción (Android). iOS fuera de alcance v1.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2–3 semanas  
**Depende de:** F6 completa

### Checklist de cierre de fase

- [ ] Tareas F7 **Android** marcadas como hechas (filas iOS descartadas v1)
- [ ] App publicada en **Google Play**
- [ ] Web sigue operativa como canal alternativo
- [ ] Bitácora: `F7 COMPLETA` — **mobile Android v1 cerrado**

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F7-01 | Keystore Android (producción) | Firmado seguro; backup en lugar seguro | ⬜ Pendiente | — |
| F7-02 | Certificados iOS distribución | Perfiles y cert en Apple Developer | ⏸ Descartado v1 | — |
| F7-03 | Build producción AAB | EAS production → Google Play | ⬜ Pendiente | — |
| F7-04 | Build producción iOS | EAS production → App Store Connect | ⏸ Descartado v1 | — |
| F7-05 | Ficha Google Play | Descripción, capturas, feature graphic | ⬜ Pendiente | — |
| F7-06 | Ficha App Store | Metadata, capturas por dispositivo | ⏸ Descartado v1 | — |
| F7-07 | Data Safety (Google Play) | Ubicación, fotos, identificadores declarados | ⬜ Pendiente | — |
| F7-08 | Clasificación de contenido Google | Cuestionario Play Console completado | ⬜ Pendiente | — |
| F7-09 | Cuenta demo para revisor Apple | Usuario con turno activo documentado | ⏸ Descartado v1 | — |
| F7-10 | Envío revisión Google Play | Aprobado o en revisión | ⬜ Pendiente | — |
| F7-11 | Envío revisión App Store | Aprobado o en revisión | ⏸ Descartado v1 | — |
| F7-12 | Publicación + monitoreo post-launch | App Android live; canal soporte activo | ⬜ Pendiente | — |

---

## Manual guardia (borrador F5-10)

1. Pedí a RRHH el **link de activación** (mismo que el portal web) o el APK preview interno.
2. Instalá **COSP Guardia**, abrí el link, creá/confirmá contraseña y activá el dispositivo.
3. Tabs: **Hoy** (turno + convocatoria), **Agenda**, **Alertas** (push), **Más** (credencial, eventos, novedades, tema).
4. Convocatoria de evento: en Hoy tocá **Acepto** o **No puedo**.
5. Si no llegan notificaciones: Ajustes del teléfono → COSP Guardia → permitir; en Alertas usá **Probar push FCM**.
6. Actualización: Más → **Descargar actualización** → cerrar app por completo → reabrir.

---

## Reglas de coexistencia web + app

1. **Un `deviceId` activo por legajo** — activar en app invalida web (y viceversa), comportamiento actual.
2. **Misma cuenta Firebase** — no hay usuarios separados para app.
3. **Web no se depreca** — canal alternativo permanente.
4. **`portalFeatures`** controla módulos en ambos clientes.
5. **Cambios en Functions** deben ser retrocompatibles con web hasta aviso explícito.

---

## Plantilla — copiar al cerrar una tarea

```markdown
### Bitácora
YYYY-MM-DD | F#-## | [descripción de lo entregado]

### En la fila de la tarea
Estado: ✅ Hecha | Fecha: YYYY-MM-DD

### Panel de estado
Actualizar progreso N/N y "Última tarea completada: F#-##"
```

### Plantilla — cierre de fase

```markdown
YYYY-MM-DD | F# COMPLETA | Fase [nombre] cerrada. Próxima: F#+1.
- Cambiar estado fase a COMPLETA y fecha en Panel de estado
- Marcar checklist de cierre de fase
- Actualizar "Fase activa recomendada" y "Qué falta ahora"
```

---

## Referencias

| Recurso | Ubicación |
|---------|-----------|
| Portal web empleado | `apps/web2/src/pages/empleado/dashboard.tsx` |
| Activación web | `apps/web2/src/pages/empleado/activar/index.tsx` |
| Callables backend | `apps/functions/src/index.ts` |
| Tutorial portal (web) | `docs/TUTORIAL_PORTAL_EMPLEADO_INSTALACION_Y_USO.md` |
| Firebase proyecto | `comtroldata` |

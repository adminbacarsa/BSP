# App nativa Portal Guardia — Plan e implementación

> **Versión del plan:** 1.0  
> **Inicio:** 2026-07-28  
> **Estado global:** `EN_CURSO` — Fase 1 en progreso (auth + turnos base)  
> **Alcance:** App nativa Android/iOS (Expo + React Native) en paralelo al portal web (`/empleado/*`).  
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
| **F1** | Auth, activación y turnos | `EN_CURSO` | 14 | 11/14 | — |
| **F2** | Fichada con GPS | `EN_CURSO` | 10 | 8/10 | — |
| **F3** | Ausencias, licencias y push | `EN_CURSO` | 12 | 5/12 | — |
| **F4** | Permutas de turno | `PENDIENTE` | 8 | 0/8 | — |
| **F5** | Credencial digital y UX | `PENDIENTE` | 10 | 0/10 | — |
| **F6** | Beta cerrada y hardening | `PENDIENTE` | 10 | 0/10 | — |
| **F7** | Publicación en stores | `PENDIENTE` | 12 | 0/12 | — |
| | **TOTAL** | | **88** | **21/88** | |

**Fase activa recomendada:** F3 (push F3-07+)  
**Última actualización:** 2026-07-31  
**Última tarea completada:** F3-03 / F3-04 (certificado cámara + galería en novedad móvil)

---

## Qué falta ahora

> Sección de lectura rápida. Actualizar al cerrar cada tarea.

### Próxima tarea

| ID | Tarea | Fase |
|----|-------|------|
| **F3-07** | `expo-notifications` + FCM | Permisos push; token al login | F3 |

### Bloqueantes actuales

- Completar `.env` en `apps/mobile-guardia` (copiar keys desde `apps/web2/.env.local`) para probar emulador en dispositivo.
- F0-01, F0-02, F0-03, F0-04, F0-11 pendientes (cuentas stores + Firebase + privacidad).

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
| Push notifications | ✅ (web) | ⬜ | F3 |
| Permutas | ✅ | ⬜ | F4 |
| Credencial digital | ✅ | ⬜ | F5 |
| Flags `portalFeatures` | ✅ | ⬜ | F1 |

---

## Bitácora de avances

> Entradas más recientes arriba. Una línea por tarea o hito de fase.

```
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
| F0-02 | Cuenta Apple Developer Program | Membresía activa (USD 99/año) | ⬜ Pendiente | — |
| F0-03 | App Android en Firebase Console | `google-services.json` descargado; package `com.grupobacar.cosp.guardia` | ⬜ Pendiente | — |
| F0-04 | App iOS en Firebase Console | `GoogleService-Info.plist` descargado; bundle ID definido | ⬜ Pendiente | — |
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
| F1-01 | Pantalla Splash + routing auth | Redirige a login o home según sesión | ⬜ Pendiente | — |
| F1-02 | Pantalla Login | `signInWithEmailAndPassword`; manejo de errores | ⬜ Pendiente | — |
| F1-03 | Pantalla Activación | Llama `activateAndSetPassword`; auto-login post activación | ⬜ Pendiente | — |
| F1-04 | Deep links / Universal Links | URL `.../empleado/activar/?t=TOKEN` abre app nativa | ⬜ Pendiente | — |
| F1-05 | Persistencia `deviceId` | SecureStore/Keychain; reemplaza `localStorage` | ⬜ Pendiente | — |
| F1-06 | Verificación dispositivo | Pantalla bloqueo si `deviceId` ≠ dispositivo actual | ⬜ Pendiente | — |
| F1-07 | Backend: campo `platform` | Functions guardan `ios`/`android`/`web` en activación | ⬜ Pendiente | — |
| F1-08 | `resolveEmpDocId` en portal-core | Misma lógica que `dashboard.tsx` (uid, email) | ⬜ Pendiente | — |
| F1-09 | Listener turnos Firestore | `onSnapshot` turnos del empleado; tiempo real | ⬜ Pendiente | — |
| F1-10 | UI Home — turno de hoy | Card principal con turno activo, objetivo, horarios | ⬜ Pendiente | — |
| F1-11 | UI Agenda semana/mes | Lista histórica y próximos turnos | ⬜ Pendiente | — |
| F1-12 | Lectura `portalFeatures` | Ocultar módulos deshabilitados por empresa | ⬜ Pendiente | — |
| F1-13 | Logout | `signOut` + limpieza estado local | ⬜ Pendiente | — |
| F1-14 | Prueba E2E emulador | Activar guardia prueba → ver turno del día | ⬜ Pendiente | — |

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
| F2-10 | Documentar permisos para stores | Textos finales para App Store / Play Console | ⬜ Pendiente | — |

---

# FASE 3 — Ausencias, licencias y notificaciones

**Objetivo:** Novedades RRHH y alertas push nativas.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 3 semanas  
**Depende de:** F2 completa

### Checklist de cierre de fase

- [ ] Las 12 tareas F3 marcadas como hechas
- [ ] Ausencia con adjunto llega a Firestore + Storage
- [ ] Push funciona en Android e iOS (TestFlight/internal)
- [ ] Bitácora: `F3 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F3-01 | Formulario reportar ausencia | Mismos campos que web → colección `ausencias` | ✅ Hecha | 2026-07-30 |
| F3-02 | Formulario solicitar licencia | Flujo separado o unificado según web | ✅ Hecha | 2026-07-30 |
| F3-03 | Adjunto certificado (cámara) | `expo-image-picker` → Storage `absences/{uid}/` | ✅ Hecha | 2026-07-31 |
| F3-04 | Adjunto certificado (galería) | Galería en `CertificateAttachmentField` | ✅ Hecha | 2026-07-31 |
| F3-05 | `notificarLlegadaTarde` | Botón y confirmación; estado en UI | ✅ Hecha | 2026-07-30 |
| F3-06 | Configurar APNs en Firebase | Key/cert Apple para push iOS | ⬜ Pendiente | — |
| F3-07 | `expo-notifications` + FCM | Permisos push; token al login | ⬜ Pendiente | — |
| F3-08 | Registrar token en backend | Compatible con `deleteMyTokens` existente | ⬜ Pendiente | — |
| F3-09 | Centro notificaciones in-app | Listener `user_notifications` | ⬜ Pendiente | — |
| F3-10 | Push en foreground | Toast/banner cuando app abierta | ⬜ Pendiente | — |
| F3-11 | `sendTestNotification` en app | Botón debug (solo dev o superadmin) | ⬜ Pendiente | — |
| F3-12 | Prueba cross-platform push | Notificación recibida en Android + iOS | ⬜ Pendiente | — |

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
| F4-01 | UI listado permutas | Listener `swap_requests` del empleado | ⬜ Pendiente | — |
| F4-02 | Buscar compañero | `getSwapPeople` + búsqueda local | ⬜ Pendiente | — |
| F4-03 | Candidatos de turno | `getSwapCandidates` | ⬜ Pendiente | — |
| F4-04 | Crear solicitud | `createSwapRequest` | ⬜ Pendiente | — |
| F4-05 | Responder solicitud | `respondSwapRequest` (aceptar/rechazar) | ⬜ Pendiente | — |
| F4-06 | Confirmar / cancelar | `confirmSwapRequest`, `cancelSwapRequest` | ⬜ Pendiente | — |
| F4-07 | Notificación de permuta | Push al recibir solicitud (si F3 lista) | ⬜ Pendiente | — |
| F4-08 | Prueba E2E permuta | Dos guardias: uno app, uno web | ⬜ Pendiente | — |

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
| F5-01 | Pantalla credencial | Foto, nombre, legajo, DNI, empresa | ⬜ Pendiente | — |
| F5-02 | QR de credencial | `react-native-qrcode-svg`; mismo payload que web | ⬜ Pendiente | — |
| F5-03 | Actualizar foto legajo | Cámara → Storage → doc empleado | ⬜ Pendiente | — |
| F5-04 | Cache offline credencial | Última versión visible sin red | ⬜ Pendiente | — |
| F5-05 | Pantallas error / sin conexión | UX clara; no pantalla en blanco | ⬜ Pendiente | — |
| F5-06 | Loading states globales | Skeleton o spinners consistentes | ⬜ Pendiente | — |
| F5-07 | Icono y splash app | Assets para dev y stores (1024 icon) | ⬜ Pendiente | — |
| F5-08 | Accesibilidad básica | Tamaños táctiles, contraste, labels | ⬜ Pendiente | — |
| F5-09 | Revisión en 3 tamaños pantalla | Phone pequeño, estándar, tablet | ⬜ Pendiente | — |
| F5-10 | Manual guardia (borrador) | Guía instalación app (complementa tutorial web) | ⬜ Pendiente | — |

---

# FASE 6 — Beta cerrada y hardening

**Objetivo:** Validación con guardias reales; estabilidad pre-producción.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2 semanas  
**Depende de:** F5 completa

### Checklist de cierre de fase

- [ ] Las 10 tareas F6 marcadas como hechas
- [ ] 2 semanas piloto sin incidentes P0
- [ ] Bitácora: `F6 COMPLETA`

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F6-01 | Play Internal Testing | Track interno; 10+ testers invitados | ⬜ Pendiente | — |
| F6-02 | TestFlight iOS | Build subido; testers externos | ⬜ Pendiente | — |
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

**Objetivo:** Apps en Google Play y App Store en producción.  
**Estado:** `PENDIENTE`  
**Duración estimada:** 2–3 semanas  
**Depende de:** F6 completa

### Checklist de cierre de fase

- [ ] Las 12 tareas F7 marcadas como hechas
- [ ] App publicada en ambas stores
- [ ] Web sigue operativa como canal alternativo
- [ ] Bitácora: `F7 COMPLETA` — **proyecto mobile v1 cerrado**

### Tareas

| ID | Tarea | Criterio de aceptación | Estado | Fecha |
|----|-------|------------------------|--------|-------|
| F7-01 | Keystore Android (producción) | Firmado seguro; backup en lugar seguro | ⬜ Pendiente | — |
| F7-02 | Certificados iOS distribución | Perfiles y cert en Apple Developer | ⬜ Pendiente | — |
| F7-03 | Build producción AAB | EAS production → Google Play | ⬜ Pendiente | — |
| F7-04 | Build producción iOS | EAS production → App Store Connect | ⬜ Pendiente | — |
| F7-05 | Ficha Google Play | Descripción, capturas, feature graphic | ⬜ Pendiente | — |
| F7-06 | Ficha App Store | Metadata, capturas por dispositivo | ⬜ Pendiente | — |
| F7-07 | Data Safety / App Privacy | Ubicación, fotos, identificadores declarados | ⬜ Pendiente | — |
| F7-08 | Clasificación de contenido | Cuestionarios Google + Apple completos | ⬜ Pendiente | — |
| F7-09 | Cuenta demo para revisor Apple | Usuario con turno activo documentado | ⬜ Pendiente | — |
| F7-10 | Envío revisión Google Play | Aprobado o en revisión | ⬜ Pendiente | — |
| F7-11 | Envío revisión App Store | Aprobado o en revisión | ⬜ Pendiente | — |
| F7-12 | Publicación + monitoreo post-launch | Apps live; canal soporte activo | ⬜ Pendiente | — |

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

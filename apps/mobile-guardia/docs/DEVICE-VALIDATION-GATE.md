# Informe — Validación de dispositivos (gate Mauro)

**Fecha:** 2026-09-24  
**Rama:** `cursor/device-validation-gate-a241` (desde `main`)  
**Alcance:** App móvil / portal web Expo (`apps/mobile-guardia`). **Sin OTA.**  
**Deploy hosting / firebase.json:** no tocado (Plataforma).

---

## Problema

La app mostraba turnos/alertas/tabs y **después** redirigía a `device-blocked` cuando el dispositivo no estaba validado. Además, `verifyDeviceForUser` hacía `if (!data.deviceId) return true`, dejando entrar desde cualquier dispositivo si el token estaba `verified` sin `deviceId`.

---

## Cambios

### 1. Gate estricto `deviceVerified`

| Estado | UI |
|--------|-----|
| `null` | `LoadingScreen` («Validando dispositivo…») — **sin tabs ni datos** |
| `false` | Redirect → `/device-blocked` |
| `true` | App normal |

Aplicado en:

- `useRequireAuth` / `RequireAuth`
- `app/index.tsx`
- `app/login.tsx`
- `app/(tabs)/_layout.tsx`

### 2. Hooks de datos no se suscriben hasta `deviceVerified === true`

- `useEmployeeShifts`
- `usePortalInbox`
- `useConvocatoriasCobertura`
- `useEventosPortal` / `useEventosMap` / `useConvocatoriasPendientes`
- `useObjectivesMap`
- `useSwapRequests`
- `PushNotificationsBootstrap` (registro FCM)

### 3. `needs_rebind` (sin `deviceId`)

Lógica pura en `src/lib/deviceVerification.ts` → `evaluateDeviceTokenBinding`:

- token `verified` **sin** `deviceId` → `{ verified: false, reason: 'needs_rebind' }`
- Mensaje: *"Validá este dispositivo con el mail de acceso o pedí aprobación a RRHH."*

`bypassDeviceCheck` en cualquier legajo vinculado: **sigue igual** (entra sin vincular `device_tokens`).

### 4. Errores Plataforma en `device-blocked`

| Código | Mensaje | Botón registrar |
|--------|---------|-----------------|
| `DEVICE_OWNED_BY_OTHER` | Este dispositivo está vinculado a otro colaborador. Pedile a RRHH que lo desvincule. | No |
| `RETIRED_DEVICE_NEEDS_EMAIL` | Para volver a este dispositivo usá el mail de acceso. | No |
| `needs_rebind` | Validá este dispositivo… | Pedir aprobación a RRHH |
| `other_device` | Dispositivo no vinculado… | Registrar este dispositivo |
| `never_activated` | Todavía no activaste… | No |

Parsing en `extractPlatformDeviceErrorCode` (message / details.code / customData).  
`requestDeviceRegistration` propaga `platformCode` al fallar.

---

## Coordinación con Plataforma

La app espera que las callables (`requestGuardDeviceRegistration`, activación por mail, etc.) fallen con uno de estos códigos en **message** o **details.code**:

```text
DEVICE_OWNED_BY_OTHER
RETIRED_DEVICE_NEEDS_EMAIL
```

Si Plataforma usa otro nombre, hay que alinear ambos lados. El cliente ya mapea esos strings exactos a los mensajes de Mauro.

---

## Tests

```bash
cd apps/mobile-guardia
node --experimental-strip-types --test src/lib/deviceVerification.test.ts
```

Cubre: `needs_rebind`, never_activated, other_device, match OK, mensajes Plataforma, flags de botón registrar.

---

## Fuera de alcance

- OTA / EAS update  
- Cambios a `firebase.json` / hosting  
- Implementación server-side de los códigos (Plataforma)

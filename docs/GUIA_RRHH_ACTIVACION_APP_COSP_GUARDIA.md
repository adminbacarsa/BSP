# Guía RRHH — Activar COSP Guardia (app Android)

Instrucciones para personal de RRHH / operaciones. Complementa el tutorial web del portal.

## 1) Qué necesita el vigilador

1. Celular Android.
2. App **COSP Guardia** instalada (APK preview o Play Internal Testing cuando esté disponible).
3. **Email en el legajo** (RRHH → ficha del empleado). Sin email no se puede enviar acceso.
4. Correo que pueda abrir en el celular (Gmail u otro).

## 2) Enviar / reenviar acceso

Ruta panel: **Admin → RRHH** (o Empleados).

1. Abrí la ficha del vigilador.
2. Tocá **Enviar acceso portal** / **Reenviar acceso portal**.
3. Confirmá el email que muestra el diálogo (debe ser el del legajo).
4. El vigilador recibe un mail de la empresa con dos botones:
   - **ABRIR EN COSP GUARDIA** (recomendado si tiene la app) → abre la web y ofrece pasar a la app.
   - **ACTIVAR EN EL NAVEGADOR** → activa solo en Chrome/portal web.

El enlace vence en **48 horas** y es de **un solo uso**.

## 3) Qué debe hacer el vigilador

1. Abrir el mail **en el celular Android**.
2. Preferir **Abrir en COSP Guardia**.
3. Crear contraseña (mín. 6 caracteres).
4. Ese celular queda **vinculado** al legajo (device binding).
5. Entrar con correo + contraseña en la app.

## 4) Un solo dispositivo

Por defecto solo **un celular** puede usar la app con ese legajo.

- Si cambia de teléfono: RRHH debe **reenviar acceso** (o reset de dispositivo según procedimiento interno).
- Si intenta activar un **segundo** celular sin liberar el primero → pantalla **dispositivo bloqueado**.

Excepción: flag `bypassDeviceCheck` en el legajo (solo casos especiales / lab).

## 5) Problemas frecuentes

| Síntoma | Qué revisar |
|---------|-------------|
| Error SMTP / mail no sale | Credenciales Gmail Functions; health «Gmail SMTP» en panel |
| «Sin email registrado» | Completar email en ficha RRHH |
| Botón azul del mail no hace nada | Pedir **reenviar** (mails viejos usaban link que Gmail bloqueaba) |
| App no abre desde el mail | Tiene COSP Guardia instalada? Si no, usar botón verde y banner «Abrir en app» |
| Correo o contraseña incorrectos | Reenviar acceso, reset pass desde RRHH, o «Olvidé mi contraseña» en la app |
| Olvidé la contraseña | En login de la app: ingresar correo → **¿Olvidaste tu contraseña?** (mail de Firebase). Alternativa: RRHH resetea / reenvía acceso |
| No ve turnos | Planificación publicada; turnos no en borrador; empresa correcta |
| No ve eventos EV | Cerrar sesión y volver a entrar tras reenviar acceso (refresca claim `empresaId`) |

## 6) App vs portal web

| | App COSP Guardia | Portal web `/empleado` |
|--|------------------|-------------------------|
| Instalación | APK / Play | Navegador / PWA |
| Push FCM | Sí (Android) | Limitado / VAPID web |
| Uso diario vigilador | Recomendado | Contingencia |

## 7) Piloto (mientras Play verifica)

1. Compartir APK preview por WhatsApp/Drive interno.
2. Enviar acceso portal desde RRHH.
3. Pedir captura de home con próximo turno.
4. Anotar incidencias (P0/P1) para el equipo.

Cuando Google Play Internal Testing esté activo, el flujo de instalación cambia a invite de Play; el mail de activación es el mismo.

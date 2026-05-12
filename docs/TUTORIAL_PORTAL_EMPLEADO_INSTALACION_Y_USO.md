# Tutorial del Portal del Empleado (instalación y uso)

Guía completa para implementar, habilitar y operar el Portal del Empleado de CronoApp.

## 1) Qué permite el Portal del Empleado

- Ver próximos turnos y cronograma (hoy/semana/mes).
- Marcar presente con validación de ubicación.
- Enviar solicitudes de novedad/ausencia/licencia.
- Solicitar intercambio de turno/franco.
- Recibir notificaciones push de cambios operativos.

> Las funciones visibles pueden variar por empleado según `portalFeatures` configuradas en su legajo.

---

## 2) Requisitos previos (equipo de administración)

1. Empleado creado en RRHH con email válido.
2. Acceso al backend de Firebase Functions operativo.
3. Para notificaciones push:
   - `NEXT_PUBLIC_FIREBASE_VAPID_KEY` configurada en frontend.
   - `firebase-messaging-sw.js` accesible.
4. Para envío de accesos por correo:
   - SMTP configurado en Functions (`GMAIL_USER`, `GMAIL_PASS`).

---

## 3) Alta del acceso al portal (desde RRHH)

Ruta: `Admin > RRHH`

## Opción A: enviar acceso individual

1. Abrir ficha del empleado.
2. Usar acción **Enviar acceso portal**.
3. El sistema crea/recupera usuario Auth y envía email de alta.

## Opción B: envío masivo

1. En RRHH, ejecutar **Enviar portal a pendientes**.
2. Se procesan empleados con email y sin invitación enviada.

## Resultado esperado

- El empleado recibe email con enlace para crear contraseña.
- Queda registrado estado de invitación en el legajo.

---

## 4) Instalación del portal en el teléfono/computadora del empleado

El Portal funciona como aplicación web (PWA/atajo instalado).

## Android (Chrome/Edge)

1. Abrir URL del portal en el navegador.
2. Menú del navegador > **Agregar a pantalla de inicio** o **Instalar app**.
3. Confirmar nombre e instalación.
4. Abrir desde ícono del escritorio/pantalla inicio.

## iPhone (Safari)

1. Abrir URL del portal en Safari.
2. Botón compartir > **Agregar a pantalla de inicio**.
3. Confirmar.

## PC (Chrome/Edge)

1. Abrir URL del portal.
2. Clic en ícono de instalación del navegador (barra de direcciones) o menú > Instalar app.

---

## 5) Primer ingreso del empleado

1. Abrir enlace recibido por correo.
2. Crear contraseña.
3. Iniciar sesión.
4. Revisar nombre, turno próximo y cronograma.
5. Activar notificaciones cuando el portal lo solicite.

---

## 6) Uso diario del portal (paso a paso)

## 6.1 Ver próximos turnos y ubicación

- El bloque principal muestra:
  - próximo turno,
  - franja horaria,
  - objetivo,
  - cliente,
  - puesto,
  - acceso a mapa (`Cómo llegar`).

## 6.2 Marcar presente

Condiciones operativas implementadas:

- Se habilita hasta **15 minutos antes** del inicio.
- Si el objetivo requiere geocerca:
  - valida GPS del dispositivo,
  - exige estar dentro de **80 metros** aprox.
- Si no hay conexión:
  - guarda la solicitud localmente,
  - la sincroniza automáticamente cuando vuelve Internet.

Resultado:

- Se envía solicitud al backend (`requestCheckIn`).
- Operaciones puede verla como novedad de ingreso.

## 6.3 Enviar solicitud de ausencia/licencia

1. Abrir panel **Solicitar novedad / ausencia**.
2. Elegir tipo (Vacaciones, Enfermedad, ART, Injustificada, Licencia Esp.).
3. Completar fechas y motivo.
4. Para **Enfermedad** o **ART**, adjuntar certificado (si aplica).
5. Enviar.

Estado:

- La solicitud se crea como **Pendiente**.
- RRHH la revisa y responde.

## 6.4 Solicitar intercambio de turno/franco

1. Elegir turno propio.
2. Buscar compañero.
3. Seleccionar turno objetivo del compañero.
4. Enviar solicitud.

Ciclo de estados:

1. `PENDING_PEER`: espera respuesta del compañero.
2. `PENDING_REQUESTER`: espera confirmación final del solicitante.
3. `APPROVED` o `REJECTED` o `CANCELLED`.

El solicitante puede cancelar según estado.

## 6.5 Notificaciones

Funciones disponibles:

- Activar notificaciones.
- Recibir push de cambios (asignación, modificación, novedades, etc.).
- Marcar notificación leída individual o masivamente.
- Desactivar notificaciones.
- En entornos habilitados, ejecutar notificación de prueba.

---

## 7) Qué hace cada área cuando llegan solicitudes

## RRHH

- Gestiona solicitudes de ausencias/licencias.
- Aprueba/rechaza y deja trazabilidad.

## Planificación

- Ajusta turnos frente a ausencias o intercambios aprobados.
- Reasigna cobertura por objetivo/puesto.

## Operaciones

- Monitorea presentes, ausencias y vacantes en tiempo real.
- Activa cobertura táctica, retenciones o escalados.

---

## 8) Resolución de problemas frecuentes

## “No puedo marcar presente”

Revisar:

- hora del turno (aún muy temprano),
- permisos de ubicación en el teléfono,
- distancia al objetivo (fuera de geocerca),
- conexión de red.

## “No llegan notificaciones”

Revisar:

- permiso de notificaciones del navegador,
- token/dispositivo registrado,
- VAPID key configurada en el entorno.

## “No puedo entrar al portal”

Revisar:

- email correcto en legajo,
- invitación enviada,
- contraseña creada desde enlace vigente.

## “Error de conexión desde otra PC”

Si trabajan con emuladores/local:

- validar host/IP de emuladores,
- evitar usar `localhost` cuando frontend y emulador están en equipos distintos,
- abrir puertos necesarios en firewall.

---

## 9) Checklist de implementación rápida

- [ ] Crear legajo con email.
- [ ] Enviar acceso portal desde RRHH.
- [ ] Validar primer login.
- [ ] Instalar acceso en el teléfono del empleado.
- [ ] Activar permisos de ubicación y notificaciones.
- [ ] Probar “dar presente”.
- [ ] Probar solicitud de ausencia.
- [ ] Probar intercambio de turno.


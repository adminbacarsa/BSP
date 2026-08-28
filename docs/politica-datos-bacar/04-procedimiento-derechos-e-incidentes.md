# Procedimiento de derechos de los titulares e incidentes

**Bacar S.A.**  
**Versión:** 1.0 — borrador interno  
**Fecha:** 28/08/2026  
**Complementa:** `01-politica-proteccion-datos.md`  
**Canal:** `{{mail_datos}}`

---

## A. Derechos de los titulares (acceso, rectificación, actualización, supresión)

### A.1 Quién puede pedir

Cualquier persona cuyos datos trate la Empresa: empleado, ex empleado, postulante, contacto de cliente, usuario de COSP.

El pedido puede hacerlo el titular o un apoderado con instrumento suficiente. No se exige abogado para el trámite interno.

### A.2 Canal y registro

1. Entrada preferente: `{{mail_datos}}`  
   Alternativa: nota en mesa de entrada / RRHH, con fecha de recepción.
2. RRHH (personal) o el responsable de la base (clientes / terceros) abre un registro interno:

   | Campo | Contenido |
   |-------|-----------|
   | Fecha de recepción | dd/MM/yyyy |
   | Titular | Nombre, DNI |
   | Tipo | Acceso / rectificación / actualización / supresión / otro |
   | Sistemas a revisar | COSP, papel, Excel, mail, etc. |
   | Vencimiento interno | Recepción + **10 días hábiles** para responder (meta interna; la ley fija criterios de acceso — no dilatar) |
   | Resultado | Entregado / rechazado con motivo / parcialmente |

3. Identificar al solicitante (DNI o equivalente) **antes** de entregar datos. No responder a un mail genérico sin verificar que es la persona.

### A.3 Acceso

Entregar, en lenguaje claro:

- Qué datos se conservan
- Finalidad
- Destinatarios o tipos de destinatarios (p. ej. “cliente del objetivo X, solo nombre y credencial”; “Google Cloud como hosting”)
- Origen del dato si no lo cargó el titular

**Formato:** copia impresa o PDF. No hace falta entregar un dump técnico de Firestore.

**Recorte:** no se entregan datos de **otras** personas (compañeros, clientes, conflictos entre empleados que identifiquen a un tercero más de lo necesario). En conflictos, informar al titular solo la existencia de una restricción que lo afecta, sin el relato completo del otro, salvo obligación legal.

### A.4 Rectificación y actualización

- Legajo COSP: RRHH / usuario con permiso RRHH `update` corrige el campo.
- Turnos históricos: no se “reescribe la historia” para maquillar una fichada; se deja nota / novedad si hubo error de sistema.
- Si el dato viajó a un encargado (nómina, cliente), se replica la corrección cuando sea material.

### A.5 Supresión o bloqueo

Se **concede** cuando el dato sobra o es ilícito.

Se **deniega o se sustituye por bloqueo** cuando existe:

- Relación laboral vigente y el dato es necesario
- Obligación legal de conservar (AFIP, ART, seguridad privada, orden judicial)
- Reclamo o investigación abierta
- Interés de prueba de la Empresa proporcional y lícito (p. ej. fichada de un incidente en el objetivo)

La baja en COSP de empleados/clientes es **lógica** (`INACTIVE`). Eso **no** cumple una orden de destrucción. Si hay que destruir: IT define el procedimiento (no `deleteDoc` improvisado sobre turnos en cascada).

GPS de fichada: si el titular pide borrado de coordenadas y ya pasó el plazo de conservación operativa, **sí** se debe poder anonimizar la coordenada dejando el hecho horario si liquidación lo requiere.

### A.6 Empleados activos

El acceso a **propios** turnos y datos de portal no reemplaza el derecho de acceso formal, pero se fomenta que el guardia use el portal para consultar su malla. Pedidos sobre salud (certificados) se atienden por RRHH, no por operaciones.

### A.7 Respuesta negativa

Por escrito, con motivo (obligación legal, derechos de terceros, pedido no identificado). Indicar que queda habilitada la vía AAIP / habeas data.

### A.8 Costos

El acceso periódico razonable es **gratuito**. Solicitudes reiteradas manifiestamente infundadas pueden diferirse; no se usa el costo para disuadir.

---

## B. Incidentes de seguridad

### B.1 Qué es un incidente (ejemplos)

| Tipo | Ejemplo |
|------|---------|
| Pérdida de dispositivo | Celular con COSP logueado; notebook con Excel de plantel |
| Divulgación | Lista de DNI/CUIL por WhatsApp o mail al destinatario equivocado |
| Acceso indebido | Usuario que ve otra empresa o un objetivo que no le toca |
| Cuenta comprometida | Phishing, contraseña reutilizada, sesión SuperAdmin compartida |
| Storage | Link de foto o certificado reenviado |
| Cloud | Credenciales Firebase / secrets Gemini o AFIP filtrados (p. ej. en git) |

### B.2 Alarma — día 0

Quien detecta:

1. Avisa **el mismo día** a IT Leader y a `{{responsable}}` (y RRHH si hay plantel).
2. No “esconder” el hecho para “arreglarlo en silencio”.
3. Si el canal sigue abierto (Drive público, grupo de WhatsApp): **contener** (quitar el archivo, cerrar sesión, resetear clave) **sin destruir evidencia**.

IT registra:

- Fecha/hora de detección y de ocurrencia (si se conoce)
- Sistemas y titulares afectados (aunque sea “plantel completo objetivo X”)
- Datos involucrados (¿hay sensibles? ¿GPS? ¿DNI?)
- Contención aplicada

### B.3 Clasificación — 72 horas corridas

IT + responsable de la base clasifican:

| Nivel | Criterio | Acción |
|-------|----------|--------|
| **Bajo** | Un usuario, dato no sensible, contenido de inmediato (sesión dejada abierta, sin copia) | Acta interna; refuerzo de uso |
| **Medio** | Planilla de contactos, GPS de fichadas, fotos de credencial, varios titulares | Informar a afectados si el dato salió de control; reset de accesos; revisar encargados |
| **Alto** | Certificados de salud, padrones DNI/CUIL + domicilios, secrets de cloud, acceso masivo | Informar afectados; evaluar denuncia AAIP y, si corresponde, autoridad penal / cliente del objetivo; considerar cambio de secretos y rotación de claves |

En **72 horas** debe existir una clasificación escrita, aunque sea preliminar.

### B.4 Comunicación a titulares

Se informa cuando hay **riesgo relevante** (el dato puede usarse para fraude, discriminación, acoso, o quedó en manos de quien no debía).

Contenido mínimo del aviso:

- Qué pasó (sin tecnicismos innecesarios)
- Qué datos
- Qué medidas se tomaron
- Qué puede hacer el titular (cambiar claves, ignorar mails raros)
- Canal `{{mail_datos}}`

No se miente sobre el alcance. Si aún se está midiendo, se dice.

### B.5 Comunicación a AAIP y a clientes

- **AAIP:** no hay en la Ley 25.326 un régimen idéntico al GDPR de “72 h a la autoridad”, pero la Agencia puede requerir información y las buenas prácticas indican notificar incidentes graves. La decisión la toma `{{responsable}}` con letrado.
- **Cliente:** si el incidente expone datos del **cliente** o compromete un objetivo, avisar al referente contractual. Si solo es plantel Bacar, no se comparte el detalle clínico/gremial con el cliente.

### B.6 Playbook técnico COSP (IT)

1. Revocar sesiones / deshabilitar usuario Auth
2. Rotar secrets (`GEMINI_API_KEY`, AFIP) si hubo exposición
3. Revisar `audit_logs` y Cloud Logging
4. No borrar logs
5. Si se filtró `google-services.json` u otra credencial de cliente: rotar en Firebase Console (ya hubo un antecedente de sacar ese archivo del git)
6. Verificar reglas Firestore no hayan quedado abiertas en un deploy

### B.7 Cierre

Informe breve: causa, impacto, acciones, responsables, fecha de cierre. Lecciones al procedimiento o a la política si hace falta. Revisión de accesos SuperAdmin.

---

## C. Pedidos de autoridad

Oficios judiciales, policiales o de autoridad de seguridad privada:

1. Recibe `{{responsable}}` / Dirección; no un operador de piso por WhatsApp
2. Se entrega **lo pedido**, no el plantel entero “por las dudas”
3. Se deja copia del oficio y de lo entregado
4. Si el pedido es verbal, pedir respaldo escrito salvo urgencia de vida/seguridad del objetivo, y documentar

---

## D. Contactos internos (completar)

| Función | Nombre | Teléfono / mail |
|---------|--------|-----------------|
| Responsable de la base | `{{responsable}}` | `{{mail_datos}}` |
| IT Leader | Mauro Martinez | `PENDIENTE` |
| RRHH | `{{responsable_rrhh}}` | `PENDIENTE` |
| Dirección | `PENDIENTE` | `PENDIENTE` |

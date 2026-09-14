## Internal Testing

**Link de invitación (testers):**  
https://play.google.com/apps/internaltest/4701606202645789130

Cada tester debe:
1. Abrir el link con la cuenta Gmail agregada a la lista
2. Aceptar ser tester
3. Instalar **COSP Guardia** desde Play Store (puede tardar minutos en aparecer)

Package: `com.cosp.guardia` · AAB production v1.1.3 (versionCode 2)

---

Package: `com.cosp.guardia`  
Versión app: `1.1.3` (versionCode lo pone EAS, hoy 2)

## Respuestas punto por punto (Panel Play)

### 1. Política de privacidad
URL: `https://comtroldata.web.app/privacidad-cosp-guardia/`

### 2. Datos de inicio de sesión
- La app **tiene restricciones** (no es pública abierta).
- Proporcionar usuario de prueba (guardia piloto o lab) con correo + contraseña.
- Instrucciones: “Abrir app → Ingresar con el correo/contraseña indicados. Ir a Hoy / Agenda / Alertas.”
- Si aún no hay user piloto: crear uno por RRHH (activar portal) o usar cuenta de prueba.

### 3. Anuncios
**No** contiene anuncios.

### 4. Clasificación de contenido
Cuestionario IARC: todo **No** (violencia, sexo, drogas, apuestas, etc.). Categoría resultante típica: **Everyone / PEGI 3** o equivalente.

### 5. Audiencia objetivo
- Edad: **18 y más** (trabajadores adultos).
- **No** dirigida a niños.
- No es app “hecha para niños”.

### 6. Seguridad de los datos
Ver tabla §2 del doc. Resumen:
- Recolecta: ubicación (fichada), fotos (certificados), IDs/tokens, email, nombre/legajo.
- No se vende.
- Cifrado en tránsito: sí.
- Compartido: solo infraestructura Google/Firebase (FCM), no marketing terceros.

### 7. Aplicaciones gubernamentales
**No** es una app gubernamental.

### 8. Funciones financieras
**No** (sin pagos, préstamos, trading, cripto, etc.).

### 9. Salud
**No** es app de salud (los certificados médicos son adjuntos laborales, no funciones de salud del tipo medical app).

### 10. Categoría y contacto
- Categoría: **Negocios** o **Productividad**
- Email contacto: el de la cuenta Play / soporte IT
- Teléfono: opcional
- Sitio: `https://comtroldata.web.app`

**Nombre:** COSP Guardia

**Descripción corta** (máx. 80):
```
Portal del vigilador: turnos, fichada GPS, alertas y credencial digital.
```

**Descripción completa:**
```
COSP Guardia es la app del vigilador para operar el día a día en empresas de seguridad privada.

• Ver turnos del día y agenda
• Marcar presencia con validación de ubicación (GPS)
• Recibir alertas de planificación, operaciones y eventos
• Credencial digital con QR y código de verificación
• Solicitar novedades RRHH (ausencias / licencias) según permisos de la empresa
• Eventos especiales (EV) y permutas cuando la empresa los habilite

Multi-empresa: cada vigilador ve solo los datos de su legajo y empresa.
Requiere cuenta activada por RRHH.
```

**Categoría sugerida:** Productividad / Negocios  
**Contacto email:** el de la cuenta Play (o soporte Bacar / IT)  
**Sitio web (opcional):** https://comtroldata.web.app

## 2. Declaraciones / cuestionarios (ganar tiempo ahora)

### Clasificación de contenido
- Sin violencia gráfica, sin contenido sexual, sin drogas, sin apuestas
- Público objetivo: adultos trabajadores (18+)
- No dirigido a niños

### Data Safety (resumen honestos)

| Dato | ¿Se recolecta? | ¿Se comparte con terceros? | Uso |
|------|----------------|----------------------------|-----|
| Ubicación aproximada/precisa | Sí (al fichar) | No | Validar presencia en puesto |
| Fotos / imágenes | Sí (certificados en novedades) | No | Adjunto a ausencias/licencias |
| ID de dispositivo / tokens push | Sí (FCM) | Con Google FCM (infra) | Notificaciones |
| Email / cuenta | Sí (login Firebase Auth) | No (salvo Firebase como procesador) | Autenticación |
| Nombre / legajo | Sí | No | Operación del portal |

Marcar: datos cifrados en tránsito (HTTPS/TLS).  
No vender datos.  
Retención: según política operativa de la empresa / Firebase.

### Permisos Android (coinciden con la app)
- Ubicación (fichada)
- Cámara / fotos (certificados)
- Notificaciones

## 3. Política de privacidad (F0-11 — pendiente URL)

Internal Testing a veces deja subir el AAB sin URL; para producción hace falta una URL pública.

Borrador de URL deseada: `https://comtroldata.web.app/privacidad-cosp-guardia/`  
(hay que publicar la página; pedí deploy cuando quieras)

## 4. App Links (después del 1er upload)

En Play Console → App integrity / App signing → copiar **SHA-256 del certificado de firma de la app**  
y pegarlo en `apps/web2/public/.well-known/assetlinks.json` (hoy hay placeholder).  
Luego deploy hosting.

## 5. Testers internos

- Crear lista de emails Gmail
- Link de invitación del track Internal testing
- Cada tester acepta y descarga desde Play (no APK suelta)

## 6. Qué NO hace falta para el primer Internal Testing

- Feature graphic 1024×500 (sí para producción)
- Capturas tablet (opcional al inicio; sí pedir phone 2–8)
- Review completo de producción

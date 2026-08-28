# Anexo de sistemas

**Bacar S.A.**  
**Versión:** 1.0 — borrador interno  
**Fecha:** 28/08/2026  
**Complementa:** `01-politica-proteccion-datos.md` y `02-inventario-tratamientos.md`

Mapa de **dónde** viven los datos. COSP está detallado porque es el sistema informatizado principal conocido. El resto de la empresa se lista con estado `PENDIENTE` cuando no hay evidencia en el repo.

---

## 1. Responsable vs sistemas

| Rol | Quién |
|-----|--------|
| Responsable de las bases | **Bacar S.A.** (`{{responsable}}`) |
| Operador técnico COSP | IT Leader (Mauro Martinez) |
| Encargado de hosting COSP | Google LLC — Firebase / Google Cloud, proyecto **`comtroldata`** |
| Hosting web producción | Firebase Hosting — `https://comtroldata.web.app` |
| Región Functions | `us-central1` |

COSP no es una persona jurídica. Todo tratamiento en COSP es tratamiento de **Bacar S.A.** (y, si hay otras empresas en el mismo proyecto, de cada titular de `empresaId`; Bacar opera como empresa `bacarsa` en el modelo multiempresa).

---

## 2. COSP (CronoApp) — arquitectura

| Capa | Tecnología |
|------|------------|
| Front | Next.js 14, TypeScript, Tailwind — `apps/web2` |
| Portal guardia web | `/empleado/*` |
| App nativa (en implementación) | `apps/mobile-guardia` — Android primero; política pública Play Store = F0-11, **fuera de esta etapa** |
| Backend | Firebase Auth, Firestore, Storage, Functions (NestJS, Node 22) |
| IA | Gemini vía Functions (`chatPlatformAssistant`, `optimizePlanningGemini`) |
| Permisos | `apps/web2/src/config/modules.ts` — módulos DASHBOARD, OPERATIONS, PLANNING, RRHH, CLIENTS, SERVICES, REPORTS, ANALYSIS, CONFIG |

Aislamiento: campo `empresaId` en colecciones operativas. SuperAdmin bypasea permisos de módulo; no bypasea esta política.

**Kill switch:** `empresas/{id}.centroControlEnabled`. Si está en `false`, no se generan novedades AUTO_T30 / avisos automáticos de ausencia para esa empresa. No borra datos.

### 2.1 Colecciones Firestore relevantes para datos personales

| Colección | Personas / datos |
|-----------|------------------|
| `empleados` | Legajo: identidad, contacto, domicilio geocodificado, foto URL, categoría, restricciones, conflictos, `uid` |
| `turnos` | Asignación, códigos CCT, presencia/ausencia, fichadas, coords de marcación, retención |
| `ausencias` | Licencias; `shiftId`; origen AUTO_T30; vínculo a adjuntos |
| `novedades` | Alertas operativas ligadas a turno |
| `tipos_novedad` | Catálogo (incluye MAVIC); no es dato de una persona salvo el uso |
| `clients` / `clientes` | Cliente + `objetivos[]` (dirección y GPS del **puesto**) |
| `servicios_sla` / `contratos_servicio` | Contrato comercial; contactos si se cargan |
| `hours_balances` | Extracto mensual por objetivo (horas, no precios) |
| `planificacion_estados` | Qué malla está publicada |
| `roles` | Permisos — dato de usuarios internos |
| `system_users` / `client_users` | Cuentas de panel |
| `payroll_settings` | Modo horas (`planned` \| `real`) por empresa |
| `audit_logs` | Quién modificó qué |
| `user_notifications` | Avisos a usuarios |
| `swap_requests` | Permutas de turno (identifican empleados) |
| `empresa_afip_credentials` | Certificado AFIP **de la empresa** (no de personas); reglas: sin lectura cliente |
| `empresas` | Configuración, `centroControlEnabled`, metadatos AFIP |
| `hours_balances` / reportes | Agregados de horas por persona en origen (turnos) |

Storage:

| Ruta típica | Contenido |
|-------------|-----------|
| `credenciales/{empId}/foto.png` | Foto de credencial |
| `credenciales/{empId}/foto_sb.png` | Foto sin fondo |
| `absences/{uid}/` | Certificados (salud / constancias) |

### 2.2 GPS — dos tratamientos distintos

1. **Domicilio del empleado** (`empleados.lat` / `lng`): geocodificación de la dirección de legajo (callable de geocoding). Sirve para estimar distancia al objetivo en planificación. No se actualiza solo. No es ubicación en vivo.
2. **Fichada** (`requestCheckIn`): coordenada al marcar presente. Se compara con el GPS del **objetivo** (radio ~80 m). El objetivo puede tener `allowRemoteCheckIn`. Cola offline en el dispositivo hasta recuperar red.

El GPS del **objetivo** es dato del puesto (cliente), no del vigilador.

### 2.3 AFIP (clientes)

- Callable `lookupClientByCuit`
- WSAA + padrón Constancia de Inscripción (`ws_sr_constancia_inscripcion`)
- Credenciales por empresa: `empresa_afip_credentials/{empresaId}`
- Fallback: secrets globales `AFIP_CUIT`, `AFIP_CERT`, `AFIP_PRIVATE_KEY`, `AFIP_PRODUCTION`
- Finalidad: autocompletar ficha de **cliente**, no consultar personas del plantel

### 2.4 Gemini

| Función | Qué ve |
|---------|--------|
| `chatPlatformAssistant` | Usuario autenticado; herramientas de **lectura** acotadas a la empresa; timeout largo; modelo por defecto `gemini-2.5-flash` |
| `optimizePlanningGemini` | Contexto de malla para correcciones puntuales |
| Portal empleado | Solo datos propios |

Reglas de esta política hacia IT (aún no necesariamente codeadas todas):

- No adjuntar PDFs médicos al prompt
- No usar PG/E/A como feature de ranking de “confiabilidad”
- No loguear prompts con DNI/CUIL en claro en tickets públicos
- El chat del globo **no se persiste** en Firestore (sesión en memoria; papelera limpia el hilo)

### 2.5 Liquidación

- `payroll_settings/{empresaId}.hoursMode`
- Endpoint de horas hacia el sistema de nómina — **encargado externo `PENDIENTE`**
- Importación de marcaciones (Excel / “Marcaciones CC”) — es alta de datos de presencia; tratarla como fichada

### 2.6 Medidas técnicas ya existentes (a mantener)

- Auth + reglas Firestore (`firestore.rules` — no modificar sin entender el impacto)
- Permisos por módulo; soft delete de personas (`status: INACTIVE`)
- Secretos Gemini/AFIP en servidor / Secret Manager, no en `NEXT_PUBLIC_*`
- Multiempresa: no mezclar planteles
- Producción distinta del lab (emuladores 8080/9099). El lab no debe alimentarse con base real de clientes

### 2.7 Medidas que esta política exige y hay que verificar

- [ ] Baja de Auth al egreso (no dejar portal activo)
- [ ] Retención / borado de coordenadas de fichada a los 24 meses (hoy **no** hay job documentado)
- [ ] Que operación no descargue certificados desde RRHH
- [ ] Inventario de quien tiene SuperAdmin
- [ ] Aviso de transferencia internacional en el ingreso (cláusula `05`)

---

## 3. Correo electrónico

| Ítem | Detalle |
|------|---------|
| **Estado** | `PENDIENTE` dominio y administrador |
| **Uso esperado** | Contratos, citaciones, invitaciones al portal (`portalInvite`) |
| **Regla** | No adjuntar padrones completos de DNI. Usar enlaces COSP con permiso, no Excel por mail masivo |

## 4. WhatsApp / radio

| Ítem | Detalle |
|------|---------|
| **Estado** | `PENDIENTE` listado de grupos |
| **Regla** | Canal operativo de cobertura. Prohibido certificados, fotos de DNI, listas de CUIL, domicilios |

## 5. Excel / planillas / file server

| Ítem | Detalle |
|------|---------|
| **Estado** | `PENDIENTE` |
| **Riesgo** | Copias del plantel desactualizadas y sin control de acceso |
| **Regla** | COSP es la fuente de verdad del plantel operativo. Toda planilla exportada tiene dueño, fecha y fecha de destrucción |

## 6. Nómina / estudio contable

| Ítem | Detalle |
|------|---------|
| **Estado** | `PENDIENTE` nombre del estudio o software |
| **Datos que COSP ya puede ceder** | Horas (plan o real), identificación por DNI/legajo en reportes |
| **Exigencia** | Contrato o cláusula de encargado: finalidad liquidación, no reutilizar, devolver/borrar al fin |

## 7. AFIP (obligaciones de Bacar S.A.)

Distinto del lookup de clientes: altas, Libro de sueldos, etc. Sistema y consultor: `PENDIENTE`. Conservación según normas fiscales.

## 8. ART / medicina laboral

`PENDIENTE`. Exámenes preocupacionales y denuncias no están modelados como colección propia en COSP; pueden vivir en `ausencias` (código A) + papel.

## 9. Mutual / SUVICO / MAVIC

En COSP, MAVIC es un **tipo de novedad** (licencia de capacitación). No implica cesión automática del legajo a la mutual. Cualquier envío de listados a SUVICO debe tener finalidad y mínimo de campos.

## 10. Videovigilancia

`PENDIENTE`. Ver inventario §15. Si el sistema es del **cliente**, Bacar no copia DVR ni se lleva grabaciones. Si es de Bacar, hay que cartelería + plazo + responsable.

## 11. Dispositivos de desarrollo y lab

| Recurso | Nota |
|---------|------|
| Notebook de desarrollo | Código; `.env.local` **no** se commitea |
| N8N `192.168.0.8` | Lab de testing; seed de prueba (`admin@bacarsa.com.ar`), no producción |
| Seeds | Usuarios ficticios de laboratorio |

Quien apunte el front de lab a **producción** (`NEXT_PUBLIC_USE_EMULATOR=false`) está tratando datos reales: aplica 100 % esta política.

## 12. Diagrama de flujo de datos COSP (resumen)

```text
[Empleado] --portal/app--> [Firebase Auth]
                         --> [Functions: check-in, asistente, AFIP, Gemini]
                         --> [Firestore: turnos, empleados, ausencias]
                         --> [Storage: fotos, certificados]

[Panel admin] -----------> [Firestore + Functions]
                         --> [Reportes / endpoint nómina] --> [Estudio PENDIENTE]

[RRHH] ------------------> [empleados, ausencias, Storage certificados]

[Google Gemini] <--------- [Functions; sin API key en el front]

[AFIP] <------------------ [lookup CUIT cliente; obligaciones fiscales PENDIENTE]
```

## 13. Alta de un sistema nuevo

Antes de producción (incluida la URL pública de privacidad para Play Store):

1. Actualizar este anexo y el inventario `02`
2. Definir base jurídica y retención
3. Si hay encargado nuevo: contrato
4. Si hay transferencia al exterior adicional: informar a titulares
5. IT revisa secretos, reglas y permisos

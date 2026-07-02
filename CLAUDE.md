# COSP V1.0 — Protocolo de trabajo para agentes IA

> **Lectura obligatoria al iniciar cualquier sesión de trabajo.**
> Este archivo es la fuente de verdad para todos los agentes (Claude Code, Cursor/Claude Agent, etc.).
> Si algo cambió en el proyecto y no está reflejado aquí, actualizá este archivo.

---

## 0. Cómo usar este archivo según la herramienta

### Claude Code (Notebook)

Lo lee **automáticamente** al iniciar sesión — no hace falta hacer nada.

### Cursor / Claude Agent (N8N u otro agente)

Pegá esto al **inicio del chat** (o equivalente en el prompt del sistema):

```text
Leé el archivo CLAUDE.md en la raíz del proyecto antes de empezar. Es el protocolo de trabajo del equipo y define arquitectura, convenciones, flujo git/deploy y qué no tocar.
```

Para **cualquier agente nuevo**: misma instrucción. Este archivo resume stack, colecciones Firestore, códigos de turno, módulos de permisos, flujo Notebook → N8N → producción y reglas de trabajo.

### Mantenimiento

Si cambia algo importante (nueva colección, regla de seguridad, módulo, flujo de deploy), **actualizá `CLAUDE.md`** en el mismo PR o commit; así Claude Code y quien pegue la instrucción en Cursor quedan alineados en la próxima sesión.

---

## 1. ¿Qué es este proyecto?

**COSP V1.0** — Sistema de gestión operativa para empresas de seguridad privada.

Funcionalidades principales:
- **Planificación de turnos**: asignar guardias a objetivos/puestos por período
- **Operaciones en tiempo real**: monitor de guardias activos, ausentes, vacantes
- **RRHH**: legajos, novedades, ausencias, licencias
- **CRM**: clientes, objetivos, servicios/SLA
- **Reportes**: detalle de turnos y planificación con horas y estados
- **Portal empleado**: el guardia ve sus turnos, marca presencia, pide licencias
- **Roles y permisos**: por módulo (ver/crear/editar/borrar)

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 14 (static export), TypeScript, Tailwind CSS |
| Backend | Firebase (Firestore, Auth, Functions) |
| Functions | NestJS sobre Firebase Functions (Node.js) |
| Hosting | Firebase Hosting |
| Estado | React hooks + Firestore real-time (`onSnapshot`) |
| UI | Componentes propios + Lucide React icons + Sonner (toasts) |

Firebase **Functions** (`apps/functions`): runtime **Node.js 22** (`engines` en `package.json`). **`firebase-functions` v7+** usa por defecto la API v2; las callables/triggers **de 1ª gen** importan **`firebase-functions/v1`** (`https.onCall`, `runWith`, `region`, etc.). HTTPs que ya usan **`firebase-functions/v2/https`** o **`v2/scheduler`** se mantienen así.
---

## 3. Estructura del repo

```
cronoapp/
├── apps/
│   ├── web2/                  ← Frontend Next.js (TODO el código UI)
│   │   ├── src/
│   │   │   ├── pages/admin/   ← Páginas del panel de administración
│   │   │   │   ├── operaciones/index.tsx   ← Monitor en tiempo real
│   │   │   │   ├── planificacion/index.tsx ← Planificador de turnos
│   │   │   │   ├── rrhh/index.tsx          ← RRHH y novedades
│   │   │   │   ├── crm/index.tsx           ← Clientes y objetivos
│   │   │   │   ├── servicios/index.tsx     ← SLA, puestos; análisis de turnos/esquema (sin costeo)
│   │   │   │   ├── reportes/index.tsx      ← Reportes y liquidación
│   │   │   │   └── configuracion/index.tsx ← Roles, usuarios, empresa
│   │   │   ├── pages/empleado/dashboard.tsx ← Portal del guardia
│   │   │   ├── hooks/
│   │   │   │   ├── useOperacionesMonitor.ts ← Lógica central de operaciones
│   │   │   │   ├── usePlanificacion.ts      ← Lógica de planificación
│   │   │   │   └── useReportes.ts           ← Lógica de reportes
│   │   │   ├── services/      ← Acceso a Firestore (CRUD)
│   │   │   ├── context/       ← AuthContext, EmpresaContext
│   │   │   └── config/modules.ts ← Definición de módulos y permisos
│   │   └── .env.local         ← Config local (NO commitear)
│   ├── functions/             ← Firebase Functions (NestJS)
│   │   └── src/
│   │       ├── auth/          ← Gestión de usuarios Auth
│   │       ├── data-management/ ← CRUD empleados, clientes, etc.
│   │       └── scheduling/    ← Lógica de turnos y patrones
├── firebase.json              ← Config Firebase + emuladores
├── firestore.rules            ← Reglas de seguridad Firestore
├── CLAUDE.md                  ← Este archivo
└── scripts/                   ← Scripts utilitarios de admin
```

---

## 4. Colecciones Firestore clave

| Colección | Descripción |
|-----------|-------------|
| `turnos` | Turnos planificados y operativos. Campo clave: `objectiveId`, `employeeId`, `startTime`, `endTime`, `origin`, `isPresent`, `isAbsent` |
| `clients` | Clientes con array `objetivos[]` embebido |
| `empleados` | Legajos. Campo `uid` = Firebase Auth UID |
| `ausencias` | Ausencias/licencias. `shiftId` vincula con turno. `origin: 'AUTO_T30'` = generada automáticamente |
| `novedades` | Alertas operativas. `shiftId` vincula con turno |
| `planificacion_estados` | Publicación de planificación. Key: `${objectiveId}_${year}_${month}` |
| `servicios_sla` | Contratos/SLA con estructura de puestos y turnos permitidos |
| `roles` | Permisos por módulo. Estructura: `{ permissions: { MODULE_KEY: ['read','create',...] } }` |

### Campos importantes en `turnos`

```typescript
origin: 'RETEN' | 'OPERATIONS_COVERAGE' | 'SLA_VIRTUAL' | undefined  // turno operativo vs planificado
isPresent: boolean       // guardia marcó presencia
isAbsent: boolean        // guardia ausente
isCompleted: boolean     // turno finalizado (checkout)
isReportedToPlanning: boolean  // vacante enviada a planificación
isFranco: boolean        // día franco
draft: boolean           // borrador (no mostrar en ops)
resolvedBy: 'OPERACIONES' | undefined
```

### Regla crítica: turno operativo vs planificado

```typescript
const isOperationalOrigin = (shift) =>
    shift.origin === 'RETEN' ||
    shift.origin === 'OPERATIONS_COVERAGE' ||
    shift.origin === 'SLA_VIRTUAL' ||
    !!shift.isReten ||
    shift.resolvedBy === 'OPERACIONES';
```

Los turnos **operativos** siempre se muestran en operaciones.
Los turnos **planificados** solo se muestran si la planificación está publicada (`planificacion_estados`).

---

## 5. Módulos y permisos

Definidos en `apps/web2/src/config/modules.ts`:

| Key | Módulo | Ruta |
|-----|--------|------|
| `DASHBOARD` | Dashboard Principal | `/admin` |
| `OPERATIONS` | Operaciones | `/admin/operaciones` |
| `PLANNING` | Planificación y Turnos | `/admin/planificacion` |
| `RRHH` | RRHH y Legajos | `/admin/rrhh` |
| `CLIENTS` | Clientes y Objetivos | `/admin/crm` |
| `SERVICES` | Servicios y SLA | `/admin/servicios` |
| `REPORTS` | Reportes y Liquidación | `/admin/reportes` |
| `ANALYSIS` | Análisis Operativo | `/admin/analisis` |
| `CONFIG` | Configuración Global | `/admin/configuracion` |

Acciones por módulo: `read`, `create`, `update`, `delete`.
`isSuperAdmin` bypasea todos los permisos.

### Asistente virtual (globo en la app)

- UI: `AssistantFloatingBubble` en `_app` (sesión **sólo en memoria**; botón papelera limpia el hilo). El **FAB es arrastrable**; la posición se guarda en `sessionStorage` hasta cerrar pestaña/navegador.
- Backend: callable Firebase **`chatPlatformAssistant`** (`apps/functions/src/index.ts` + `assistant/*`) invoca **Gemini** con API key en **servidor**. Con permiso READ y `empresaId` en sesión, herramientas **sólo lectura** Firestore (**`listado_empleados_empresa`** nombres/id de legajos; búsqueda por fragmento con **`buscar_empleados_por_nombre`**; **`consultar_turnos_empleado`** por rango AR; **`resumen_horas_empleado_periodo`** agregados de horas planificadas de cobertura y reales fichadas por legajo y rango; **`resumen_presencias_objetivos_dia`** agregados de presencia/ausencia por día; **`listado_turnos_operativos_dia`** lista de turnos visibles; **`contar_servicios_sla_vigentes_empresa`** cuántos SLA están activos y vigentes en la fecha para clientes de la empresa; **`contar_empleados_plantilla_empresa`** legajos activos/inactivos por `empresaId`). En producción: **`timeoutSeconds: 180`**, **`memory: 512MB`**, secreto **`GEMINI_API_KEY`**. El cliente envía **`clientToday`** (YYYY-MM-DD) y **timeout ~210 s** en el `httpsCallable`. Portal **empleado**: sólo turnos propios.
- **IA ajuste fino de planificación:** el front llama la callable **`optimizePlanningGemini`** (`planningGeminiServer.ts` + export en `index.ts`); usa el mismo secreto **`GEMINI_API_KEY`**. No hay `NEXT_PUBLIC_GEMINI_*` en el bundle. Deploy selectivo: `firebase deploy --only functions:optimizePlanningGemini` si el deploy completo de functions timeouta.
- **Agente planificación automática (pipeline):** motor determinístico **`autoScheduleEngineV2`** (viabilidad → generación) en `apps/web2/src/lib/planificacion/`; verificación **`coverageVerification`**; ajuste fino **`optimizePlanningGemini`** (no regenera el mes desde cero). Contrato/orquestación: `apps/functions/src/assistant/planningAgent/planningAgentTypes.ts`. UI: botón **Automatizar** en `planificacion/index.tsx`. Skill Cursor para desarrollo: **`.cursor/skills/cosp-planificacion-agent/`** (invocar `@cosp-planificacion-agent`). Smoke: `npm run eval:planning-agent`.
- **VPLAN (cerebro experimental, paralelo):** documentación completa en **`docs/VPLAN.md`**. Código aislado en `apps/functions/src/vplan/` (callable **`vplanRun`**) y cliente lab `apps/web2/src/lib/vplan/`. **No modifica** wizard Automatizar ni motores V2/V4. **Solo emulador** en fase prueba (handler rechaza prod hasta sign-off). **Sin deploy** hasta checklist §10 de `docs/VPLAN.md`. Smoke: `npm run eval:vplan`.
- **Producción (hosting + app real):**
  1. Crear el secreto (una vez): en la raíz del repo ejecutá `firebase functions:secrets:set GEMINI_API_KEY` y pegá la API key cuando pida valor (queda en Google Secret Manager).
  2. Desplegar: `firebase deploy --only functions`. La función `chatPlatformAssistant` ya declara `secrets: ['GEMINI_API_KEY']` y Firebase inyecta `process.env.GEMINI_API_KEY` en runtime.
  3. Si rotás la key: volvé a `secrets:set` con versión nueva y redeploy de functions.
  4. Si `firebase deploy --only functions` falla por timeout al analizar el código, en PowerShell ejecutá antes: `$env:FUNCTIONS_DISCOVERY_TIMEOUT='120'` (o `60`; el default **10 s** suele bastar hasta que el `index.ts` cargue demasiadas dependencias). Usá también deploy por nombre: `firebase deploy --only functions:chatPlatformAssistant`, etc.
  5. Alternativa manual: Cloud Console → Secret Manager / variables de la función — menos alineado con el manifest de Firebase.
- Front: `getFunctions(app, 'us-central1')` en `firebase.ts` debe coincidir con la región de la callable desplegada.
- **Laboratorio local (emulador):** el asistente usa la callable **sin** `runWith(secrets)` (en emulador las secrets de prod no vienen cargadas).
  - Poner **`GEMINI_API_KEY=...`** en **`apps/functions/.env`** (o `.env.local` en esa carpeta) y **reiniciar** solo el proceso del emulador de Functions (`npm run emulators`, etc.). `bootstrap-env.ts` fusiona `.env` + `.env.local` cuando `FUNCTIONS_EMULATOR=true`.
  - También válido: PowerShell `$env:GEMINI_API_KEY='...'` antes de arrancar el emulador.
  - `GEMINI_API_KEY` — obligatoria para que responda.
  - `GEMINI_MODEL` — opcional (default `gemini-2.5-flash`; `gemini-1.5-flash` suele dar 404 en proyectos/API keys nuevas).
  - **Usuario no reconocido por el asistente** (`Tu cuenta no está asociada…`): el backend resuelve el perfil con `system_users/{uidAuth}`, `client_users` o `empleados.uid`. En emulador, si falta `system_users` pero el login tiene **custom claim `role: SUPERADMIN`** (como deja `seed-admin.js`), hay **respaldo por Auth** sólo con `FUNCTIONS_EMULATOR=true`. Si aun así falla: levantá **Firestore + Auth + Functions** juntos (`npm run emulators`), ejecutá **`npm run seed`** (o `node scripts/seed-admin.js`) y **cerrá sesión y volvé a entrar** si recreaste el usuario de Auth (cambia el UID).
- **Dataset entrenamiento/evaluación (pares Q + guía respuesta):** `apps/functions/src/assistant/assistantTrainingPairs.ts` (`ASSISTANT_TRAINING_PAIRS`, ~135 ítems). No se inyecta solo en el prompt; sirve para tests, few-shot manual o export externo.
- **Guías por módulo (UX):** si el cliente manda `moduleKey` (ej. `PLANNING`), el servidor inyecta texto operativo en `cospKnowledge` + `operationalGuideForModuleKey`, y el prompt (`ASSISTANT_RESPONSE_STYLE` en `runPlatformAssistant`) favorece respuestas con pasos numerados, **negritas** para controles UI y honestidad sobre límites del chat; el globo renderiza `**texto**` en negrita.
- **CSR / certificado AFIP (primera vez):** `npm run afip:csr` o `scripts/generate-afip-csr.ps1` — genera `privada.key` (2048 bits) y CSR PKCS#10 con `serialNumber = CUIT {11 dígitos}` (manual [AFIP WSASS](https://www.afip.gob.ar/ws/WSASS/html/generarcsr.html)). El **Alias** en AFIP debe coincidir con el **CN** del CSR. Salida en `scripts/afip-csr-{cuit}/` (gitignored).
- **CRM — autocompletar cliente por CUIT (AFIP):** callable **`lookupClientByCuit`** (`apps/functions/src/afip/*`, WSAA directo + padrón Constancia de Inscripción). UI: **AFIP** en nuevo cliente; ficha INFO **Actualizar desde AFIP** / **AFIP y guardar**. El cliente envía **`empresaId`** (empresa activa del panel). Credenciales **por empresa**: colección `empresa_afip_credentials/{empresaId}` (solo Admin SDK; reglas `allow read, write: if false`); metadatos en `empresas` (`afipConfigured`, `afipCertCuit`, `afipProduction`, `afipCertNotAfter`). Carga: **Configuración → Empresas** → sección **Certificado AFIP** (SuperAdmin/admin); callables **`saveEmpresaAfipCredentials`**, **`getEmpresaAfipConfig`**. Mismo cert puede repetirse en varias empresas del panel. **Fallback** si no hay doc por empresa: secrets globales **`AFIP_CUIT`**, **`AFIP_CERT`**, **`AFIP_PRIVATE_KEY`**, **`AFIP_PRODUCTION`**. CSR: `npm run afip:csr`; secrets globales: **`npm run afip:secrets`** (prod) o **`npm run afip:secrets:homo`**. WSASS: **`ws_sr_constancia_inscripcion`**.
---

## 6. Códigos de turno (CCT 422/05)

### Turnos de trabajo

| Código | Nombre | Horas | Computa horas | Notas |
|--------|--------|-------|---------------|-------|
| `M` | Mañana | 8h | ✅ | Banda fija diurna |
| `T` | Tarde | 8h | ✅ | Banda fija vespertina |
| `N` | Noche | 8h | ✅ | Banda fija nocturna |
| `D12` | Diurno 12h | 12h | ✅ | Extensión/rotativo diurno |
| `N12` | Nocturno 12h | 12h | ✅ | Extensión/rotativo nocturno |
| `RET` | Retención pasiva | 0h billables | — | Empleado en stand-by; disponible para cubrir. No genera horas facturables. Referencia interna: 8h stand-by. |
| `ESC` | Escuela | 8h | ✅ | Sobreturno de capacitación: el vigilador va al puesto a aprender. Se usa como fuente de cobertura (prioridad 3). |
| `REF` | Refuerzo | 8h | ✅ | Turno de refuerzo puntual, cobertura extra programada. |

### Francos / Descansos

| Código | Nombre | Horas | Costo extra | Notas |
|--------|--------|-------|-------------|-------|
| `F` | Franco | 0h | ❌ | Descanso planificado CCT 6+2 |
| `FF` | Franco feriado | 0h | ❌ | Descanso en día feriado |
| `FP` | Franco permuta | 0h | ❌ | Descanso por permuta de turno |
| `FT` | Franco trabajado | 8h | ✅ extra | Empleado de franco que cubre ausencia. Genera costo adicional. Requiere validación del empleado. Última opción de cobertura. |

### Ausencias / Licencias

| Código | Nombre | Horas | Computa horas | Notas |
|--------|--------|-------|---------------|-------|
| `V` | Vacaciones | — | ✅ (paga) | Período vacacional planificado |
| `L` | Licencia | — | ✅ (paga) | Licencia general (art. CCT) |
| `E` | Enfermedad | — | ✅ (paga) | Baja médica con certificado |
| `A` | Autorizada | — | ✅ (paga) | Ausencia autorizada / ART |
| `PG` | Permiso gremial | — | ✅ (paga) | Actividad sindical |
| `AA` | Ausencia injustificada | 0h | ❌ | Sin justificación ni certificado |

### Prioridad de cobertura ante ausencia

Cuando un empleado falta, el sistema busca reemplazante en este orden (menor a mayor costo):

```
1. Sin turno    — empleado disponible ese día (no tiene turno asignado)
2. RET          — vigilador en retención pasiva (stand-by)
3. ESC          — empleado en turno escuela (puede redirigirse al puesto)
4. Ext. 12hs    — extender turno de 8hs → 12hs (D12/N12) de alguien ya en servicio
                  ⚠ Requiere validación — no siempre acepta
5. FT           — llamar a empleado de franco a trabajar
                  ⚠ Requiere validación + genera costo extra (horas extras CCT)
```

Todos los candidatos deben ser del mismo objetivo. La banda a cubrir es la del empleado ausente (M cubre M, N cubre N, etc.).

---

## 7. Entorno y configuración

### Variables de entorno (`.env.local`)

```env
NEXT_PUBLIC_USE_EMULATOR=true      # true = emuladores locales, false = producción
NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.0.8  # solo si front y emuladores están en PCs distintas
NEXT_PUBLIC_FIREBASE_API_KEY=...   # credenciales reales del proyecto comtroldata
NEXT_PUBLIC_FIREBASE_PROJECT_ID=comtroldata
```

> **NUNCA commitear `.env.local`** — está en `.gitignore`.

### Emuladores Firebase (puertos)

| Servicio | Puerto |
|----------|--------|
| Firestore | 8080 |
| Auth | 9099 |
| Functions | 5001 |
| UI | 4000 |
| Emulator Hub | 4400 |

**UI `http://localhost:4000` (o `:4000` desde otra PC):** abrí también el puerto **4400** en el firewall. **`npm run emulators:light`** = solo Auth + Firestore + UI (sin **:5001** → el **asistente COSP no funciona**). Lab y asistente: **`npm run emulators`** (compila Functions, requiere **`GEMINI_API_KEY`** en `apps/functions/.env`). Si Functions falla en Windows (`""node"" no se reconoce`), el fix de PATH está en `run-emulators.js`; como último recurso podés usar `emulators:light` sin asistente.

**Windows — lab tras reinicio** (emuladores + seed + Next): no suben solos hasta registrar la tarea **COSP Lab** (PowerShell **como administrador** desde la raíz del repo):

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\register-cosp-lab-scheduled-task.ps1
```

Modo **sin iniciar sesión** (PC encendida, usuario no logueado): `...\register-cosp-lab-scheduled-task.ps1 -AtStartupAsSystem` (SYSTEM, demora 3 min; Node en `Program Files\nodejs`, JDK 21).

Diagnóstico: `npm run diagnose:lab`. Trazas siempre en **`%ProgramData%\COSP\trace.log`** (útil si falla antes de escribir en `logs\`). Quitar tarea: `npm run unregister:lab-task` (admin). Instalación guiada: **`INSTALAR-TAREA-COSP-LAB.cmd`** (clic derecho → ejecutar como administrador; por defecto **SYSTEM**; con argumento **`logon`** registra al iniciar sesión del usuario).

### Primer arranque / emulador vacío

Con emuladores activos, admin + guardia de prueba:

```bash
npm run seed
```

(Mismo comando que `npm run seed:lab`.) Equivale a `node scripts/seed-admin.js` + `node scripts/seed-empleado.js` (`admin@bacarsa.com.ar` / `admin1234`, `guardia@bacarsa.com.ar` / `guardia1234`). `seed-lab.js` espera a que **8080 y 9099** acepten conexión (evita sembrar antes de que Auth esté listo). Solo admin: `node scripts/seed-admin.js`.

**Front en :3000 “viejo”:** el dev server es `next dev` (`npm run dev` desde la raíz). Pará el proceso, borrá `apps/web2/.next`, volvé a `npm run dev` y en el navegador recarga forzada (Ctrl+F5). Si en :3000 corre **otra app** u otro clon de repo, cerrá ese proceso o cambiá el puerto en `apps/web2/package.json` (`next dev -p`).

---

## 8. PCs de trabajo

| PC | Ruta local | IP | Rol |
|----|------------|----|-----|
| **Notebook** | `C:\APP\cronoapp` | — | Desarrollo principal + deploys a producción |
| **N8N** | `D:\APP\cronoapp` | `192.168.0.8` | Servidor de testing compartido para el equipo |

Desde Notebook, N8N es accesible como `B:\cronoapp` (unidad de red).

---

## 9. Flujo de trabajo

```
DESARROLLO (Notebook)
  1. Editás código en C:\APP\cronoapp
  2. Probás en http://localhost:3000 (emuladores locales)
  3. git push origin main

TESTING (N8N — sincronizar desde Notebook)
  4. git -C /b/cronoapp fetch origin && git -C /b/cronoapp reset --hard origin/main
  5. En N8N: `npm install` y `npm run emulators`
  6. En N8N: `npm run dev` (Next en 0.0.0.0:3000)
  7. Testers acceden a http://192.168.0.8:3000

PRODUCCIÓN (Notebook)
  8. Cambiar .env.local → NEXT_PUBLIC_USE_EMULATOR=false
  9. cd apps/web2 && npm run build
  10. firebase deploy --only hosting
  11. Restaurar .env.local → NEXT_PUBLIC_USE_EMULATOR=true
```

### Reglas de trabajo

- **Commitear inmediatamente** después de cada cambio funcional. No acumular.
- **No hacer deploy automático** — solo cuando el usuario lo pida explícitamente.
- **No modificar N8N directamente** — todo cambio va por Notebook → git → N8N.
- **Responder siempre en español.**
- **No agregar comentarios obvios** al código — solo cuando el WHY es no obvio.
- **No crear archivos `.md` de documentación** salvo que se pida explícitamente.

---

## 10. Repo remoto

```
GitHub: https://github.com/adminbacarsa/BSP.git
Branch principal: main
```

Para sincronizar N8N desde Notebook:
```bash
git -C /b/cronoapp fetch origin && git -C /b/cronoapp reset --hard origin/main
```

---

## 11. Deploy a producción

Firebase Hosting → `https://comtroldata.web.app`
Firebase project: `comtroldata`

**Deploy no debe tumbar el lab.** Si emuladores (`:8080`/`:9099`) o `npm run dev` (`:3000`) están activos, `npm run deploy` usa automáticamente un **git worktree** en `../cronoapp-deploy`: build y `firebase deploy` corren ahí; esta carpeta (`cronoapp`) no ejecuta `next build`.

Artefactos de producción van a **`build/hosting`** y **`build/.next-prod`** (no `apps/web2/out` ni `.next` del dev server). `.env.local` del lab se copia al worktree solo para credenciales de build (`USE_EMULATOR=false` en el proceso de build).

```bash
# Recomendado con lab corriendo (worktree automático)
npm run deploy
npm run deploy -- --functions

# Forzar build en esta carpeta (lab apagado o explícito)
npm run deploy:here

# Siempre worktree aunque el lab esté apagado
npm run deploy:worktree
```

Variable opcional: `COSP_DEPLOY_DIR` (default `../cronoapp-deploy`).

---

## 12. Qué NO tocar sin entender bien

- `useOperacionesMonitor.ts` — lógica central de operaciones en tiempo real. Muy compleja.
- `firestore.rules` — reglas de seguridad. Cambios incorrectos pueden bloquear usuarios.
- `planificacion_estados` — controla qué planificación está publicada. No borrar documentos.
- **Borrados en CRM** (`crm/index.tsx`) — hoy `deleteDoc(clients/{id})` **no** borra en cascada `turnos` ni `servicios_sla`; cualquier limpieza debe ser **explícita** (batch, callable o trigger).

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
│   │   │   │   ├── servicios/index.tsx     ← SLA y estructura operativa
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
│   └── nvr-agent/             ← Agente Java para cámaras NVR
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

---

## 6. Códigos de turno (CCT 422/05)

| Código | Nombre | Horas | Computa horas |
|--------|--------|-------|---------------|
| `M` | Mañana | 8h | ✅ |
| `T` | Tarde | 8h | ✅ |
| `N` | Noche | 8h | ✅ |
| `D12` | Diurno 12h | 12h | ✅ |
| `N12` | Nocturno 12h | 12h | ✅ |
| `F` | Franco | 0h | ❌ (es planificado, muestra estado FRANCO) |
| `FF` | Franco feriado | 0h | ❌ |
| `FP` | Franco permuta | 0h | ❌ |
| `AA` | Ausencia injustificada | 0h | ❌ |
| `V` | Vacaciones | — | ✅ (licencia paga) |
| `L` | Licencia | — | ✅ (licencia paga) |
| `E` | Enfermedad | — | ✅ (licencia paga) |
| `PG` | Permiso gremial | — | ✅ (licencia paga) |
| `A` | Autorizada | — | ✅ (licencia paga) |

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

**Windows — lab tras reinicio (emuladores + seed + Next):** no suben solos hasta registrar la tarea **COSP Lab** (PowerShell **como administrador** desde la raíz del repo):

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\register-cosp-lab-scheduled-task.ps1
```

Modo **sin iniciar sesión** (PC encendida, usuario no logueado): `...\register-cosp-lab-scheduled-task.ps1 -AtStartupAsSystem` (SYSTEM, demora 3 min; Node en `Program Files\nodejs`, JDK 21).

Diagnóstico: `npm run diagnose:lab`. Trazas siempre en **`%ProgramData%\COSP\trace.log`** (útil si falla antes de escribir en `logs\`). Quitar tarea: `npm run unregister:lab-task` (admin). Instalación guiada: **`INSTALAR-TAREA-COSP-LAB.cmd`** (clic derecho → ejecutar como administrador; por defecto **SYSTEM**; con argumento **`logon`** registra al iniciar sesión del usuario).

### Primer arranque / emulador vacío

Con emuladores activos, admin + guardia de prueba:

```bash
npm run seed:lab
```

Equivale a `node scripts/seed-admin.js` + `node scripts/seed-empleado.js` (`admin@bacarsa.com.ar` / `admin1234`, `guardia@bacarsa.com.ar` / `guardia1234`). Solo admin: `node scripts/seed-admin.js`.

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

Comando completo desde `C:\APP\cronoapp`:
```bash
# 1. Deshabilitar emulador
sed -i 's/USE_EMULATOR=true/USE_EMULATOR=false/' apps/web2/.env.local
# 2. Build
cd apps/web2 && npm run build
# 3. Deploy
cd ../.. && firebase deploy --only hosting
# 4. Restaurar emulador
sed -i 's/USE_EMULATOR=false/USE_EMULATOR=true/' apps/web2/.env.local
```

---

## 12. Qué NO tocar sin entender bien

- `useOperacionesMonitor.ts` — lógica central de operaciones en tiempo real. Muy compleja.
- `firestore.rules` — reglas de seguridad. Cambios incorrectos pueden bloquear usuarios.
- `planificacion_estados` — controla qué planificación está publicada. No borrar documentos.
- **Borrados en CRM** (`crm/index.tsx`) — hoy `deleteDoc(clients/{id})` **no** borra en cascada `turnos` ni `servicios_sla`; cualquier limpieza debe ser **explícita** (batch, callable o trigger).

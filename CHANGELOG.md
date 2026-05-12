---

### 2. 📜 `CHANGELOG.md`

Este archivo registrará la historia de cambios. He documentado todo lo que acabamos de arreglar bajo la versión **1.1.0**. Guárdalo también en la **raíz**.

```markdown
# Changelog

Todos los cambios notables en el proyecto **ControlData** serán documentados en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
y este proyecto adhiere a Semantic Versioning.

## [Unreleased]
- Planificación de módulo de reportes avanzados.

## [1.1.0] - 2025-12-04 (Estabilización y Fixes Críticos)

### ✨ Agregado (Added)
- **Diagnóstico de Sistema:** Nuevo endpoint `checkSystemHealth` y servicio en frontend para monitorear el estado de Node.js, Base de Datos y Latencia en tiempo real.
- **Gestión de Ausencias:** Implementación completa (Backend/Frontend) para registrar novedades (Vacaciones, Enfermedad) validando reglas de negocio.
- **Seguridad Multi-tenant:** Ahora `findAllEmployees` acepta un filtro `clientId` para asegurar que los administradores solo vean empleados de la empresa seleccionada.
- **Endpoints Faltantes:** Se expusieron `manageAbsences` y `checkSystemHealth` en `index.ts`.

### 🐛 Corregido (Fixed)
- **Error de Build Frontend:** Se solucionó la falta de exportación de `callCheckSystemHealth` en `firebase-client.service.ts`.
- **Inyección de Dependencias (Backend):** Se registró correctamente `AbsenceService` en `DataManagementModule` y se exportó `WorkloadService` desde `SchedulingModule` para resolver errores de inicio de NestJS.
- **Errores de Importación:** Corregidos alias y rutas en `AbsenceManagementPage`.
- **Credenciales:** Actualización y verificación de credenciales de Firebase en el cliente.

### 🔧 Modificado (Changed)
- Refactorización de `firebase-client.service.ts` para incluir todas las definiciones `Callable` necesarias.
- Actualización de `index.ts` (Functions) para soportar los nuevos módulos de RRHH y Diagnóstico.

## [1.0.0] - 2025-11-20
- Lanzamiento inicial del MVP.
- Funcionalidades básicas: Login, Dashboard Admin, Scheduler Drag & Drop.




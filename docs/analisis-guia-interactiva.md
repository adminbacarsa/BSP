# Guía interactiva — opinión y plan

## 1. Qué es hoy (evidencia)

### 1.1 Dónde vive y cómo está implementada

- La guía in-app está en una única página React: `apps/web2/src/pages/admin/guia/index.tsx`.
- Es un wizard lineal de pasos hardcodeados en el frontend (`steps` dentro de `useMemo`), con contenido textual largo y botones **Anterior / Siguiente**.
- No hay CMS ni fuente dinámica de contenido: el texto está embebido en JSX.
- No consume Firestore ni callables de Functions para renderizar la guía (es 100% cliente estático).

### 1.2 Cómo se dispara y para quién

- El acceso principal es el menú lateral en `apps/web2/src/components/layout/DashboardLayout.tsx` (`Link` a `/admin/guia`).
- Esa opción de menú aparece dentro del bloque:
  - `canReadModule('CONFIG') || canReadModule('API_KEYS')`
  - Es decir: la visibilidad de la guía depende hoy de permisos de **Sistema**, no de un permiso propio de “guía”.
- No existe módulo `GUIDE` en `apps/web2/src/config/modules.ts`; por lo tanto, no hay control granular de permisos para esta experiencia.
- No encontré disparador automático (primer login, cambio de rol, tenant nuevo, etc.). Es navegación manual por menú o URL directa.

### 1.3 Control de acceso real (ruta)

- A diferencia de otras páginas admin (ej. `admin/configuracion/index.tsx`, que redirige si no hay permiso), `admin/guia/index.tsx` no hace validación explícita con `canReadModule(...)`.
- Conclusión técnica: la **descubribilidad** está limitada por menú, pero la **ruta** no está protegida a nivel página con una política específica de guía.

### 1.4 Persistencia de progreso y tracking

- Progreso guardado en `localStorage` con key `cosp_guia_paso`.
- Guarda un índice numérico del paso (`step`) y lo restaura en carga.
- No hay versión de esquema del progreso (si cambia el orden de pasos, el progreso previo puede apuntar a otro contenido).
- No hay telemetría de uso:
  - sin eventos de “paso visto”,
  - sin “guía completada”,
  - sin métricas por rol/empresa.

### 1.5 Cobertura funcional actual

La guía cubre estos pasos (en orden): bienvenida, CRM cliente, objetivos, servicios SLA, alta de empleados, RRHH, planificación, operaciones, reportes, cierre.

Gaps de cobertura vs producto actual:
- No cubre `ANALYSIS` (`/admin/analisis`).
- No cubre `LIQUIDACIONES` (`/admin/liquidaciones`).
- No cubre `SUPERVISION` (`/admin/supervision`).
- No cubre asistente IA (globo) ni casos de uso reales por rol.

### 1.6 Calidad técnica de enlaces de permisos dentro de la guía

En `canOpenStep` hay reglas manuales con inconsistencias:

- Paso `operaciones`: habilita abrir módulo si `DASHBOARD` o `PLANNING`; no chequea `OPERATIONS` explícitamente.
- Paso `servicios`: el tipo de `moduleKey` no contempla `SERVICES` y el paso quedó asociado a `CLIENTS`.

Resultado: puede bloquear CTA “Abrir módulo” a usuarios legítimos según su matriz real.

### 1.7 Estado mobile y discoverability

- El bottom-nav mobile (`DashboardLayout.tsx`) sólo incluye: Dashboard, Operaciones, RRHH, Reportes.
- No incluye acceso a `/admin/guia`.
- En mobile la guía queda de baja descubribilidad (prácticamente URL directa o escritorio).

### 1.8 Segunda “guía” fuera de la app (duplicación)

Además de la guía in-app, existe un tutorial independiente en docs:

- `docs/tutorial-interactivo.html`
- `docs/tutorial-assets/*`
- scripts de captura: `scripts/capture-tutorial-screens.cjs`, `scripts/capture-tutorial-flows.cjs`

Ese material también está hardcodeado y se mantiene con capturas manuales/automatizadas. Es una segunda fuente de verdad sobre cómo usar la plataforma.

---

## 2. Opinión sincera

### 2.1 Lo rescatable

1. Existe un recorrido inicial en producto (mejor que cero onboarding).
2. Tiene intención de flujo lógico “cliente → operación → reportes”.
3. Incluye deep-link por paso a módulos reales.
4. Recuerda progreso local por navegador.

### 2.2 Debilidades fuertes (francas)

1. **No es realmente “interactiva”**: es una página de lectura secuencial, no guía contextual en pantalla.
2. **Segmentación de audiencia mal resuelta**: se publica desde permisos de Config/API, cuando la necesitan perfiles operativos/planificación/RRHH.
3. **Control de acceso inconsistente**: la ruta no tiene guard específico.
4. **Mantenibilidad baja**: contenido rígido en JSX + tutorial paralelo en HTML/docs ⇒ alta probabilidad de desalineación.
5. **Sin medición de impacto**: hoy no se puede responder “¿sirve la guía?”, “¿dónde abandonan?”, “¿qué rol no completa?”.
6. **Cobertura incompleta** respecto del producto actual (Análisis, Liquidaciones, Supervisión, IA).
7. **Experiencia móvil pobre en descubrimiento** (sin entrada clara desde navegación mobile).

### 2.3 Veredicto ejecutivo

La pieza actual sirve como **manual corto embebido**, pero no como sistema de adopción de producto.  
Si el objetivo es acelerar onboarding y reducir dependencia de soporte, en su estado actual no alcanza.

---

## 3. Qué haría yo (priorizado)

### P0 — Corregir lo que hoy rompe adopción/control

1. **Definir permiso propio de guía** (ej. `GUIDE`) o política de acceso explícita por rol objetivo.
2. **Agregar guard de página** en `/admin/guia` (similar a Config): sin permiso, redirigir.
3. **Arreglar gating de CTAs por paso**:
   - Operaciones debe chequear `OPERATIONS` (además de excepciones que definan negocio).
   - Servicios debe soportar `SERVICES` en tipado y validación.
4. **Persistencia robusta**:
   - guardar `stepId` + `version`,
   - validar rango al restaurar.
5. **Instrumentar métricas mínimas**:
   - evento `guide_step_view`,
   - `guide_completed`,
   - `guide_cta_open_module`.

### P1 — Convertirla en herramienta útil para operación real

1. Externalizar contenido a estructura versionada (JSON/Firestore) para editar sin tocar código.
2. Separar recorridos por perfil:
   - Operaciones,
   - Planificación,
   - RRHH,
   - Dirección/Control.
3. Integrar “Ayuda contextual” desde cada módulo (entrypoint directo al paso correcto).
4. Cubrir módulos faltantes del stack actual (Análisis, Liquidaciones, Supervisión, IA).

### P2 — Evolución de producto (si buscan adopción premium)

1. Coachmarks/hotspots contextuales en pantallas críticas (no en todas).
2. Checklist de onboarding por empresa (estado compartido por equipo, no sólo por navegador local).
3. A/B testing simple de copys/orden de pasos para mejorar completion.

---

## 4. Quick wins vs rebuild

### Quick wins (sin rediseño estructural)

1. Guard de acceso en `admin/guia`.
2. Corregir permisos de `canOpenStep`.
3. Agregar link a guía en navegación mobile o acceso directo desde dashboard.
4. Completar pasos faltantes clave (Análisis + Liquidaciones).
5. Emitir eventos básicos de tracking.

Impacto esperado: sube la utilidad inmediata y evita falsos bloqueos de acceso sin tocar arquitectura mayor.

### Rebuild / simplificación estratégica

#### Opción A (recomendada): reconvertir

- Mantener una **guía breve in-app** (5-7 pasos críticos por rol).
- Mover el detalle largo a un centro de ayuda único (una sola fuente de verdad versionada).
- Añadir ayuda contextual en módulos de mayor fricción.

#### Opción B: “matar y rehacer”

- Retirar la guía actual y lanzar onboarding contextual desde cero.
- Útil si quieren medir adopción en serio y reducir soporte operativo de forma sistemática.

Mi criterio: **no la eliminaría sin reemplazo**; la recortaría y la reconvertiría rápido para evitar doble documentación y baja adopción.

---

## 5. Preguntas para Mauro

1. ¿La guía debe ser obligatoria para usuarios nuevos de admin (sí/no)?
2. ¿Qué rol es prioritario para onboarding en este trimestre: Operaciones, Planificación, RRHH o Dirección?
3. ¿Queremos una sola fuente de verdad (in-app o docs), o mantener dos formatos con responsabilidades claras?
4. ¿Qué KPI de adopción queremos seguir: completion rate, tiempo a primer valor, tickets evitados?
5. ¿Qué módulos son “must-have” en la guía mínima: Análisis y Liquidaciones entran en primera tanda?
6. ¿Preferís estrategia incremental (quick wins) o decisión de rebuild controlado?


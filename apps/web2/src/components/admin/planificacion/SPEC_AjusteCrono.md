# SPEC: Ajuste de Cronograma — 2 variantes

## Contexto del sistema

- **Stack**: Next.js 14 + TypeScript + Tailwind + Firebase Firestore
- **Colecciones relevantes**: `turnos`, `ausencias`, `empleados`, `clients` (con `objetivos[]`), `ajustes_horas`
- **Contextos**: `useAuth()` → `{ isSuperAdmin, empresaId, rolePermissions }` | `useEmpresa()` → `{ empresaId }`
- **Íconos**: Lucide React | **Toasts**: Sonner (`toast.success`, `toast.error`)
- **Idioma**: español argentino en todos los textos UI
- **Tipos**: definidos en `apps/web2/src/types/ajustesCrono.types.ts`

---

## Colección Firestore: `ajustes_crono`

```typescript
interface AjusteCrono {
  id: string
  empresaId: string
  tipo: 'OPERATIVO' | 'COBERTURA_AUSENCIA'

  // OPERATIVO: fechaInicio === fechaFin (un solo día)
  // COBERTURA_AUSENCIA: rango completo de la ausencia
  fechaInicio: Timestamp
  fechaFin: Timestamp

  origenObjetivoId: string
  origenObjetivoNombre: string
  motivo: string  // "Evento especial sábado" / "Vacaciones FABBRIS 3–15 jun"

  // Guardias que cambian de 8h a 12h para absorber la cobertura
  cambiosBanda: {
    employeeId: string
    employeeName: string
    bandaAnterior: 'M' | 'T' | 'N'
    bandaNueva: 'D12' | 'N12'
    turnoIds: string[]       // IDs de los turnos actualizados
  }[]

  // Guardias que quedan como RET o se asignan a otro objetivo
  retenes: {
    employeeId: string
    employeeName: string
    turnoOrigenIds: string[]
    destinoObjetivoId?: string
    destinoObjetivoNombre?: string
    destinoTurnoIds?: string[]    // turnos RETEN creados en destino
    estado: 'DISPONIBLE' | 'ASIGNADO'
  }[]

  // Solo para COBERTURA_AUSENCIA
  guardiaAusenteId?: string
  guardiaAusenteNombre?: string
  ausenciaId?: string             // link al doc en colección `ausencias`
  estrategiaCobertura?: 'COMPRIMIR_12H' | 'RETEN_EXTERNO' | 'VACANTE'

  creadoPor: string
  createdAt: Timestamp
  estado: 'ACTIVO' | 'REVERTIDO'
}
```

### Regla Firestore a agregar en `firestore.rules`

```
match /ajustes_crono/{docId} {
  allow read:   if tenantAdminRead();
  allow create: if tenantAdminCreate();
  allow update: if tenantAdminUpdate();
  allow delete: if tenantAdminDelete();
}
```

---

## VARIANTE A — Ajuste Operativo

### Caso de uso

Hay un evento puntual (un día o un fin de semana). Necesito extraer guardias de servicios regulares sin dejar el servicio descubierto.

**Mecanismo**: comprimir un servicio que normalmente corre **3×8h (M+T+N)** a **2×12h (D12+N12)**, liberando al 3er guardia como **RET** para asignarlo al evento.

Ejemplo:
- Servicio Banco Nacional: FABBRIS=M, MOLINA=T, CARRION=N
- Ajuste sábado: FABBRIS=D12, MOLINA=N12, CARRION=RET→Evento River

### Dónde vive

Botón **"Ajustar Crono"** en `apps/web2/src/pages/admin/planificacion/index.tsx`.
También accesible desde la vista diaria de operaciones.

### Archivo a crear

`apps/web2/src/components/admin/planificacion/AjustarCronoOperativoModal.tsx`

### Props

```typescript
interface Props {
  open: boolean
  onClose: () => void
  empresaId: string
  fechaInicial?: Date       // pre-carga si se abre desde el grid de un día
  objetivoInicial?: { id: string; nombre: string }  // pre-carga desde fila servicio
}
```

### Flujo de UI paso a paso

**Paso 1 — Selección de día y objetivo**

- Date picker para el día del ajuste
- Dropdown de objetivos: consulta `clients` donde `empresaId` matches y despliega `objetivos[]`
- Al seleccionar objetivo, carga los turnos del día:

```typescript
query(
  collection(db, 'turnos'),
  where('objectiveId', '==', objId),
  where('fecha', '>=', startOfDay),
  where('fecha', '<=', endOfDay),
  where('draft', '!=', true)
)
```

**Paso 2 — Tabla de asignación de bandas**

Cada fila muestra:
- Nombre del guardia
- Banda actual (`shiftCode`: M / T / N)
- Selector "Ajuste" con opciones: `M`, `T`, `N`, `D12`, `N12`, `RET`

Validaciones en tiempo real (mostrar error inline, bloquear "Guardar"):
- Si algún guardia fue marcado RET → debe haber al menos 1 D12 y 1 N12 entre los restantes
- No se puede dejar el servicio sin cobertura nocturna (todos en D12 = inválido)
- Combinación mínima válida con RET: `D12 + N12 + RET(s)`
- Si nadie cambia de banda y nadie es RET → no hay nada que guardar (botón deshabilitado)

**Paso 3 — Destino para cada guardia RET**

Al marcar un guardia como RET, aparece inline un dropdown:
- **Destino**: lista de objetivos de la empresa (opcional)
- Si no se asigna destino, queda `estado: 'DISPONIBLE'` en el pool de retenes

**Paso 4 — Motivo**

Input texto obligatorio. Ejemplos: "Evento especial", "Refuerzo operativo", "Cobertura emergencia".

**Paso 5 — Resumen antes de confirmar**

```
Resumen del ajuste — Sábado 7 jun
──────────────────────────────────
Servicio: Banco Nacional
Cobertura mantenida con:
  • FABBRIS → D12 (06:00–18:00)
  • MOLINA  → N12 (18:00–06:00)
Retenes liberados:
  • CARRION → RET  Destino: Evento River ✓
```

### Writes en Firestore al confirmar

**Guardias que cambian de banda (M→D12 / T,N→N12):**

```typescript
await updateDoc(doc(db, 'turnos', turnoId), {
  shiftCode: 'D12',  // o 'N12'
  startTime: /* fecha + '06:00:00' para D12, fecha + '18:00:00' para N12 */,
  endTime:   /* fecha+1 + '18:00:00' para D12, fecha+1 + '06:00:00' para N12 */,
})
```

Horarios exactos:
- `D12`: startTime = día 06:00, endTime = día 18:00
- `N12`: startTime = día 18:00, endTime = día+1 06:00

**Guardias marcados como RET:**

```typescript
await updateDoc(doc(db, 'turnos', turnoOrigenId), {
  origin: 'RETEN',
  isReten: true,
  objectiveId: destinoObjetivoId ?? turnoActual.objectiveId,
})
```

Si el destino es distinto al origen → crear además un nuevo turno en destino:

```typescript
await addDoc(collection(db, 'turnos'), {
  employeeId: guardia.employeeId,
  employeeName: guardia.employeeName,
  objectiveId: destinoObjetivoId,
  fecha: Timestamp.fromDate(fecha),
  shiftCode: guardia.bandaOriginal,  // mantiene su banda
  origin: 'RETEN',
  isReten: true,
  draft: false,
  empresaId,
})
```

**Crear documento en `ajustes_crono`** con `tipo: 'OPERATIVO'` y todos los campos.

---

## VARIANTE B — Ajuste por Vacaciones / Licencias / Ausencias

### Caso de uso

Un guardia tiene una ausencia registrada (vacaciones, licencia médica, ausencia injustificada). Su puesto queda sin cubrir por ese período. Hay que gestionar la cobertura.

### Dónde vive

Tab **Ausencias** en `apps/web2/src/pages/admin/rrhh/index.tsx`.

En cada fila de la tabla de ausencias agregar:
- Columna **"Cobertura"**: muestra badge `PENDIENTE` / `GESTIONADA` / `VACANTE`
- Botón **"Cubrir"** visible cuando `coberturaEstado` es `PENDIENTE` o ausente
- Botón **"Ver ajuste"** cuando `coberturaEstado` es `GESTIONADA`

### Archivo a crear

`apps/web2/src/components/admin/rrhh/AjustarCronoCoberturaModal.tsx`

### Props

```typescript
interface Props {
  open: boolean
  onClose: () => void
  empresaId: string
  ausencia: {
    id: string
    employeeId: string
    employeeName: string
    startDate: Date
    endDate: Date
    tipo: 'VACACIONES' | 'LICENCIA' | 'AUSENCIA' | 'ENFERMEDAD'
  }
}
```

### Flujo de UI paso a paso

**Paso 1 — Información de la ausencia (solo lectura)**

- Nombre del guardia ausente
- Período: "3 jun al 15 jun (13 días)"
- Tipo de ausencia
- Objetivo donde trabaja normalmente (inferir de sus turnos → `objectiveId`)
- Banda habitual del guardia (M/T/N)

**Paso 2 — Elegir estrategia de cobertura**

Radio buttons:

```
○ COMPRIMIR A 12H
  Los compañeros del mismo servicio pasan a D12+N12
  para el período completo. Aplica si el servicio
  tiene exactamente 3 guardias.

○ RETÉN EXTERNO
  Traés un guardia RET de otro servicio para cubrir
  el turno del ausente en este objetivo.

○ MARCAR COMO VACANTE
  El turno queda vacante. Operaciones lo verá como
  puesto sin cubrir.
```

**Paso 3A — COMPRIMIR A 12H**

- Muestra los compañeros del servicio y sus bandas actuales
- Selección automática sugerida: guardia M o T → D12, guardia N → N12
- Permite editar la asignación manualmente
- Muestra resumen de horas extras informativo (no normativo)
- Se aplica a TODOS los días del período de ausencia

**Paso 3B — RETÉN EXTERNO**

- Dropdown "Objetivo origen del RET" (de qué servicio viene)
- Al seleccionar origen → muestra guardias disponibles con sus bandas
- Selección del guardia que será RET
- El sistema muestra el impacto en el servicio origen (quién cambia a 12h para compensar)
- Es equivalente a ejecutar la Variante A sobre el servicio origen, pero iterado para cada día del período

**Paso 3C — VACANTE**

- Solo campo motivo/nota
- Los turnos del ausente quedan con `isAbsent: true`, `isReportedToPlanning: true`

**Paso 4 — Resumen multi-día**

```
Resumen: 13 días ajustados (3 jun → 15 jun)
─────────────────────────────────────────────
Guardia ausente: FABBRIS (M) — Vacaciones

Estrategia: COMPRIMIR A 12H
  MOLINA  T → D12  (13 turnos a actualizar)
  CARRION N → N12  (13 turnos a actualizar)

Total horas extras estimadas: ~26h (informativo)
El ajuste es reversible desde esta misma pantalla.
```

Botón **"Aplicar ajuste"** — ejecuta los writes.
Botón **"Cancelar"** — cierra sin guardar.

### Writes en Firestore al confirmar

**Turno del guardia ausente** — por cada día del período:

```typescript
await updateDoc(doc(db, 'turnos', t.id), {
  isAbsent: true,
  ausenciaId: ausencia.id,
})
```

**Compañeros con cambio de banda** (COMPRIMIR_12H) — por cada día del período:

Igual que Variante A, pero iterado sobre cada día en el rango `fechaInicio..fechaFin`.

**RETÉN_EXTERNO** — por cada día del período:

Igual que Variante A (cambios de banda en origen + turno RETEN en destino), iterado por día.

**Crear documento `ajustes_crono`:**

```typescript
{
  tipo: 'COBERTURA_AUSENCIA',
  fechaInicio: Timestamp.fromDate(ausencia.startDate),
  fechaFin:    Timestamp.fromDate(ausencia.endDate),
  guardiaAusenteId:     ausencia.employeeId,
  guardiaAusenteNombre: ausencia.employeeName,
  ausenciaId:           ausencia.id,
  estrategiaCobertura:  'COMPRIMIR_12H' | 'RETEN_EXTERNO' | 'VACANTE',
  // ...resto del modelo
}
```

**Actualizar el documento de ausencia** para vincular:

```typescript
await updateDoc(doc(db, 'ausencias', ausencia.id), {
  ajusteCronoId:    nuevoAjusteId,
  coberturaEstado:  'GESTIONADA',  // o 'VACANTE'
})
```

---

## Resumen de archivos

### Crear

| Archivo | Descripción |
|---------|-------------|
| `src/types/ajustesCrono.types.ts` | ✅ Ya existe — contrato TypeScript completo |
| `src/components/admin/planificacion/AjustarCronoOperativoModal.tsx` | Modal Variante A |
| `src/components/admin/rrhh/AjustarCronoCoberturaModal.tsx` | Modal Variante B |

### Modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/admin/planificacion/index.tsx` | Agregar botón "Ajustar Crono" + import del modal |
| `src/pages/admin/rrhh/index.tsx` | Agregar columna "Cobertura" + botón "Cubrir" en tabla ausencias |
| `firestore.rules` | Nueva regla para colección `ajustes_crono` |

### No tocar

| Archivo | Por qué |
|---------|---------|
| `useOperacionesMonitor.ts` | Los turnos con `isReten: true` ya se procesan como RETEN |
| `useReportes.ts` | Las horas D12/N12 se calculan por `startTime`/`endTime` (ya funciona) |

---

## Reglas de negocio críticas

1. **Mínimo para RET operativo**: si se libera un guardia como RET, el servicio origen DEBE quedar cubierto con al menos D12 + N12. Validar antes de guardar.

2. **Reversibilidad**: el documento `ajustes_crono` con `estado: 'ACTIVO'` debe poder revertirse. Al revertir: restaurar los `shiftCode`/`startTime`/`endTime` originales en los turnos modificados, eliminar los turnos RETEN creados, actualizar `estado: 'REVERTIDO'`.

3. **Idempotencia**: antes de guardar, verificar que no existe ya un `ajustes_crono` activo para el mismo objetivo + fecha (OPERATIVO) o para la misma `ausenciaId` (COBERTURA_AUSENCIA). Evitar duplicados.

4. **Horas D12/N12**: D12 = 06:00–18:00 (12h), N12 = 18:00–06:00+1 (12h). Ambas son válidas por CCT 422/05. El sistema de reportes las calcula por diferencia de `startTime`/`endTime`, no por `shiftCode`.

5. **Turno RET en destino**: solo crear el turno RETEN en destino si el destino es distinto al objetivo origen. Si es el mismo objetivo, solo actualizar el turno existente.

# COSP V1.0 — Protocolo para agentes IA

Archivo corto a propósito: se lee en cada mensaje. **El detalle de cada módulo está en `docs/CLAUDE-DETALLE.md`** (buscá ahí con grep la sección que necesites, no lo leas entero). Docs canónicos por módulo: `docs/PROMPT-*.md`.

## Qué es
Gestión operativa para seguridad privada: Planificación de turnos, Operaciones en tiempo real (Centro de Control), RRHH, CRM/Servicios (SLA), Prefactura, Reportes/Liquidación, Eventuales (ARCA), portal/app del guardia.

## Stack
Next.js 14 (static export) + TypeScript + Tailwind en `apps/web2`. Firebase (Firestore, Auth, Functions Node 22, Hosting) — proyecto `comtroldata`. Functions en `apps/functions` (`firebase-functions/v1` para 1ª gen). App guardia: `apps/mobile-guardia` + `packages/portal-core`. Lógica compartida ops: `packages/ops-core` (espejos en functions: mantener idénticos).

## Estructura clave
- Páginas: `apps/web2/src/pages/admin/{operaciones,planificacion,rrhh,crm,servicios,reportes,configuracion}`
- Lógica pura de planificación: `apps/web2/src/lib/planificacion/*` (continuarMesAnterior, armarMesServicio, prepararMes, bandaFijaVolante, modoRapido, cierre12h, lecturaBandas…)
- Hooks: `useOperacionesMonitor.ts` (central de Ops, no tocar sin entender)
- Permisos: `apps/web2/src/config/modules.ts`

## Colecciones principales
`turnos`, `clients` (objetivos embebidos), `empleados`, `ausencias`, `servicios_sla`, `planificacion_estados` (publicación, no borrar), `ordenes_compra`, `hours_ledger*` (solo servidor), `roles`, `novedades`, `eventuales_bolsa`, `grupos_objetivos`.

Turno operativo vs planificado: operativo = `origin` RETEN/OPERATIONS_COVERAGE/SLA_VIRTUAL, `isReten` o `resolvedBy: OPERACIONES` (siempre en Ops). Planificado solo se ve en Ops si el mes está publicado.

Períodos: Liquidación ciclo **26→25**; Prefactura/SLA mes calendario **1→fin**. Helper `lib/hoursPeriod.ts`.

## Reglas de negocio que no se negocian
- Códigos CCT 422/05: M/T/N 8 h, D12/N12 12 h, RET stand-by (0 h facturables), ESC, F/FF/FP francos, FT franco trabajado (lo más caro, último recurso), licencias V/L/E/A/PG/ART, AA injustificada. REF eliminado: RFZF (permanente) / RFZE (eventual).
- Jornada: tope 12:59 h; máx. 6 turnos seguidos de 8 h / 4 de 12 h (48 h, 56 h excepcional); descanso < 8 h nunca, 8–12 h con PIN; tope mensual 200 h (más con PIN).
- Banda fija + volante: si en el mes anterior ≥70 % de los turnos de trabajo caen en una banda, esa persona la conserva al continuar y al armar. Quien no tiene banda dominante es volante y cubre el franco del fijo en esa banda. Los turnos que solo corren sáb/dom (NE) se reparten por horas del ciclo 26→25, primero a quien menos tiene, para no pasar 200 h (`bandaFijaVolante.ts`).
- Cobertura Bacar: falta una banda → D12+N12 de los otros dos; nunca Ext/Adel para la N. Orden: RET/disponibles/volantes → 12 h → FT.
- Ext/adel de otro puesto del mismo objetivo tapa un hueco solo en las horas que se superponen, una sola vez, y no suma facturable sobre lo vendido. TURA sí se factura aparte (`extEntrePuestos.ts`). En la grilla se carga igual que la TURA: +1…+4 h antes o después, eligiendo Cobertura o TURA (`extCoberturaRapido.ts`).
- Puesto M+T+N: cantidades iguales → `24hs` con `quantity` = ese PAX; distintas (1-2-2) → `custom` con `quantity` por banda (nunca 24 h × el máximo). `trabajaFeriados: false` (−F) saca los feriados de cobertura y de horas vendidas; sin el campo se trabaja (+F).
- El servicio de un mes se copia solo desde el mes anterior (M-1) si ese SLA no está inactivo ni cerrado (`closed !== true`) y el cliente sigue activo. Se crea al abrir Planificación y al publicar (`lib/servicios/copiarSlaMes.ts`; espejo en functions). Hueco, origen cerrado/vencido o cliente inactivo no se crean solos: el botón confirma el mes origen y la copia masiva deja «con hueco: revisar». No duplica un mes que ya tiene SLA.
- Servicio desde planilla: horario del código según catálogo de la empresa o el servicio del objetivo (NE/NO/NN/TT/MA incluidos). Sin horario conocido se pregunta; no se inventa M/T/N 8 h ni N12. `activeDays` = unión de los días de las franjas.

## Entorno
`.env.local` en `apps/web2` (no commitear). Emuladores: Firestore 8080, Auth 9099, Functions 5001, UI 4000. `npm run emulators`, `npm run seed`, `npm run dev` (:3001). Mauro prueba en **prod pruebas_sa**.

## Verificación antes de publicar
- `npm run test:planif-cobertura` (raíz).
- `npx tsc --noEmit --types node -p .` en `apps/web2`: comparar contra la base (740 al 17/10); `next build` ignora tipos.
- Scripts de prod son **solo lectura**; `--apply --allow-prod` solo con OK de Mauro.

## Flujo y deploy
- Responder siempre en español. Sin comentarios obvios. No crear .md salvo pedido.
- Commit por cambio funcional; **push y deploy solo cuando Mauro lo pide**.
- Deploy: `git push origin main && npm run deploy:worktree` (hosting). `deploy:functions` / `deploy:all` (reglas) por nombre — PowerShell se come el `--`.
- Antes de deployar revisar `git log origin/main..`. Functions no puede importar de `web2` ni `packages` (ver `check:functions-standalone`).
- Tras hosting, OTA de la app: `npm run update:production` en `apps/mobile-guardia` (cuando aplique).

## No tocar sin entender
`useOperacionesMonitor.ts`, `firestore.rules`, docs de `planificacion_estados`, baja de clientes CRM (soft delete).

## Mantenimiento
Cambios importantes: una línea acá y el detalle en `docs/CLAUDE-DETALLE.md`.

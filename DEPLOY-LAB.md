# Deploy sin tumbar el lab local

En COSP el **lab** (emuladores + `localhost:3000`) y el **deploy a producción** usan carpetas separadas para que un `npm run deploy` no mate Firestore en `:8080` ni rompa el dev server.

## Por qué

El build de producción (`next build`, compilación de Functions, `firebase deploy`) consume mucha **RAM y CPU**. En Windows eso suele cerrar la JVM del emulador Firestore o dejar el lab inestable. Además, antes el build escribía en `apps/web2/out`, mezclado con el entorno de desarrollo.

## Dos carpetas

| Carpeta | Rol | Puertos típicos |
|---------|-----|-----------------|
| `C:\APP\cronoapp` | **Lab** — código, emuladores, dev, backups JSON | `:3000`, `:8080`, `:9099`, `:5001`, `:3010` (bridge) |
| `C:\APP\cronoapp-deploy` | **Deploy** — git worktree; solo build + firebase | ninguno del lab |

Artefactos de producción (no commitear):

- `build/.next-prod` — cache del build Next
- `build/hosting` — lo que sube Firebase Hosting (`firebase.json` → `"public": "build/hosting"`)

El dev sigue usando `apps/web2/.next` — **no se toca** en deploy.

## Comandos

### Con el lab corriendo (recomendado)

Si hay algo escuchando en `:8080`, `:9099` o `:3000`, `npm run deploy` **detecta el lab** y deploya desde `cronoapp-deploy` automáticamente:

```powershell
# Solo hosting
npm run deploy

# Hosting + Cloud Functions
npm run deploy -- --functions

# Hosting + reglas Firestore
npm run deploy -- --rules

# Todo
npm run deploy -- --all
```

### Forzar deploy en la carpeta actual

Solo si el lab está **apagado** o querés build local explícito (escribe en `build/`, no en `apps/web2/out`):

```powershell
npm run deploy:here
npm run deploy:here -- --functions
```

### Siempre worktree (aunque el lab esté apagado)

```powershell
npm run deploy:worktree
npm run deploy:worktree -- --functions
```

## Primera vez

1. Tener el repo en `main` actualizado (`git pull`).
2. Ejecutar `npm run deploy` (con o sin lab activo).
3. Si no existe, se crea `C:\APP\cronoapp-deploy` con `git worktree add`.
4. Se corre `npm install` en esa carpeta (solo la primera vez tarda).
5. Se copia `apps/web2/.env.local` del lab al worktree **solo para credenciales** de build (no commitear).

Variable opcional:

```powershell
$env:COSP_DEPLOY_DIR = "D:\deploy\cosp"
npm run deploy:worktree
```

## Flujo de trabajo habitual

```
1. Desarrollás en cronoapp (emuladores + npm run dev)
2. git commit && git push origin main
3. npm run deploy          → build en cronoapp-deploy, emulador sigue vivo
4. Probás https://comtroldata.web.app
```

El lab **no necesita reiniciarse** después del deploy.

## Lab local — recordatorio

```powershell
# Terminal 1
npm run emulators

# Terminal 2 (importación de backups grandes)
npm run emulator-bridge

# Terminal 3
npm run dev
```

Importar backup JSON (~10 MB):

- UI: Configuración → Backups → recuadro amarillo (con bridge en `:3010`)
- CLI: `npm run seed:backup -- "C:\ruta\backup.json" --empresa bacarsa`

## Si el emulador igual se cayó

1. Verificá que usaste `npm run deploy` (worktree) y no `npm run deploy:here` con lab activo.
2. Revisá `backups/latest` — al cerrar emuladores con Ctrl+C se exporta Firestore.
3. Si `backups/latest` quedó vacío, `run-emulators.js` restaura desde `backups/previous` al salir.
4. Reiniciá: `npm run emulators` → `npm run seed` si hace falta usuarios base.

## N8N (servidor de testing)

En N8N no hace falta worktree para deploy a producción (deploy se hace desde Notebook). Para sincronizar código de prueba:

```bash
git -C /b/cronoapp fetch origin && git -C /b/cronoapp reset --hard origin/main
npm install && npm run emulators && npm run dev
```

## Referencia rápida

| Problema | Solución |
|----------|----------|
| Deploy mata emulador | `npm run deploy` (auto worktree) |
| Quiero build en esta PC sin worktree | Lab apagado + `npm run deploy:here` |
| Cambiar carpeta de deploy | `$env:COSP_DEPLOY_DIR=...` |
| Hosting desactualizado | `npm run deploy` desde lab con push previo |
| Functions desactualizadas | `npm run deploy -- --functions` |

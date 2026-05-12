# ControlData (Cronoapp)

**ControlData** es una plataforma SaaS de gestión de fuerza laboral (WFM), diseñada para empresas de seguridad y servicios. Permite la gestión integral de empleados, control de asistencia por geolocalización, planificación de turnos y administración multi-empresa (Multi-tenancy).

## 🏗️ Arquitectura y Stack

El proyecto es un **Monorepo** que integra Frontend y Backend:

* **Frontend (`apps/web`):**
    * **Framework:** Next.js 16 (Static Export).
    * **Estilos:** Tailwind CSS.
    * **Estado/Lógica:** React Context (ClientContext) + Hooks personalizados.
* **Backend (`apps/functions`):**
    * **Runtime:** Firebase Cloud Functions (Node.js 20).
    * **Framework:** NestJS (Inyección de dependencias y arquitectura modular).
    * **Base de Datos:** Firestore (NoSQL).
    * **Auth:** Firebase Authentication (Custom Claims para roles).

## 🚀 Requisitos Previos

* Node.js v20+
* NPM
* Firebase CLI (`npm install -g firebase-tools`)
* Java (Opcional, solo si se desea usar el Emulador de Firebase localmente)

## 🛠️ Instalación y Configuración

1.  **Clonar/Descargar el repositorio.**
2.  **Instalar dependencias raíz y workspaces:**
    ```bash
    npm install
    ```

## Forma de trabajar (flujo estándar)

1. **Desarrollar en local**  
   Editar código en `apps/web2/src`, ver cambios en vivo:
   ```bash
   npm run dev
   ```
   Abrir **http://localhost:3000** (o el puerto que indique la terminal).

2. **Probar y compilar**  
   Cuando esté listo, generar la versión estática:
   ```bash
   npm run build
   ```
   Eso genera la carpeta `apps/web2/out/`.

3. **Probar el build en local (opcional)**  
   Ver la misma versión que se va a desplegar:
   ```bash
   npm start
   ```
   Abrir **http://localhost:5005**.

4. **Desplegar**  
   Subir a Firebase (o tu hosting):
   ```bash
   firebase deploy --only hosting
   ```

Resumen: **dev** (trabajar) → **build** (compilar) → **deploy** (publicar).  
`npm start` sirve para revisar el build localmente antes o después del deploy.

### Backend (Functions)
Para compilar y observar cambios en el backend TypeScript:
```bash
npm run build --prefix apps/functions -- --watch
# O para levantar emuladores (si están configurados)
npm run serve --prefix apps/functions




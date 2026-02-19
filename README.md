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

## 💻 Desarrollo Local

### Frontend oficial (versión final)

La versión de referencia para el equipo se ejecuta en el puerto `5005`.

```bash
# servidor estático de la versión final publicada
npm run serve:final
```

URL:

```text
http://localhost:5005
```

### Frontend editable (web2)

Si necesitás modo desarrollo sobre `apps/web2`, también corre en `5005`:

```bash
npm run dev:web2
```

### Backend (Functions)
Para compilar y observar cambios en el backend TypeScript:
```bash
npm run build --prefix apps/functions -- --watch
# O para levantar emuladores (si están configurados)
npm run serve --prefix apps/functions




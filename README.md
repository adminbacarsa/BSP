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

## Cómo ejecutar la plataforma (una sola versión)

Hay **una única versión** para usar. Mismo comando en cualquier equipo:

```bash
npm install
npm start
```

Abrir en el navegador: **http://localhost:5005**

No hay otro puerto ni otra URL. Si algo corre en 3000 u otro puerto, no es la versión oficial.

---

### Para desarrolladores (opcional)

Si editás código en `apps/web2` y querés ver cambios en caliente: `npm run dev:web2` (puerto 3000). No reemplaza la versión oficial; la versión oficial es solo la de `npm start` en 5005.

**Importante:** No ejecutar `npm run build` dentro de `apps/web2` salvo que vayas a publicar una nueva versión y a hacer commit de `apps/web2/out`. Ese build sobrescribe la versión oficial.

### Backend (Functions)
Para compilar y observar cambios en el backend TypeScript:
```bash
npm run build --prefix apps/functions -- --watch
# O para levantar emuladores (si están configurados)
npm run serve --prefix apps/functions




# Demo E2E NVR AI Alert

Automatiza seed en Firestore, envío al webhook y verificación de la alerta.

## Requisitos

- Node 18+
- Cuenta de servicio Firebase (JSON) con permisos Firestore y opcional Storage.
- Webhook desplegado y con **Cloud Functions Invoker** para `allUsers` (o la cuenta que use el test).

## Configuración

1. Copia `config.example.json` a `config.json` en esta carpeta.
2. Ajusta `projectId`, `webhookUrl`, `secret` (debe coincidir con `nvr_config/webhook.secret` en Firestore).
3. Pon la ruta a tu cuenta de servicio en `serviceAccountPath` (relativa a la raíz del repo o absoluta).

## Uso

Desde la **raíz del repo**:

```bash
# Instalar dependencias (form-data, firebase-admin)
npm install

# 1. Seed: crea nvr_config/webhook y camera_routes/default__2
npm run nvr-alert:seed

# 2. Test E2E: POST con imagen mínima y verificación en Firestore
npm run nvr-alert:demo
```

Si el test pasa, verás el `alertId`, la verificación del doc en `alerts` y la `image_url`. Si no tienes cuenta de servicio, el webhook igual se ejecuta y devuelve `alertId`; la verificación en Firestore se omite y el script sale OK.

# Crear documentos NVR en Firestore a mano

Si `npm run nvr-alert:seed` falla por credenciales, crea estos documentos en **Firebase Console → Firestore**:

---

## 1. `nvr_config` (colección) → documento `webhook`

| Campo       | Tipo   | Valor    |
|------------|--------|----------|
| `secret`   | string | `123456` |
| `updated_at` | timestamp | (opcional) |

---

## 2. `camera_routes` (colección) → documento ID: `default__2`

| Campo         | Tipo    | Valor                 |
|---------------|---------|------------------------|
| `enabled`     | boolean | `true`                 |
| `camera_name` | string  | `Entrada Principal`    |
| `objective_id`| string  | `OBJ_PILOTO`           |
| `post_id`     | string  | `PUESTO_ENTRADA`       |
| `event_type`  | string  | `Tripwire`             |

---

Después ejecuta: `npm run nvr-alert:demo`

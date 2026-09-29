"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHIFT_ALERT_FCM_TYPES = exports.SHIFT_ALERT_CHANNEL_ID = void 0;
exports.isShiftAlertFcmType = isShiftAlertFcmType;
exports.shiftAlertPlatformConfig = shiftAlertPlatformConfig;
exports.SHIFT_ALERT_CHANNEL_ID = 'alertas_turno';
exports.SHIFT_ALERT_FCM_TYPES = new Set([
    'CONVOCATORIA_COBERTURA',
    'AVISO_TURNO_PROXIMO',
    'AVISO_ENTRANTE_SIN_FICHAR',
    'RETENCION_AVISO',
    'SOLICITUD_ESTADO_LLEGADA',
    'SOLICITUD_ESTADO_RELEVO',
    'CONVOCADO_RECORDATORIO',
]);
function isShiftAlertFcmType(type) {
    return exports.SHIFT_ALERT_FCM_TYPES.has(String(type || '').trim().toUpperCase());
}
function shiftAlertPlatformConfig() {
    return {
        android: {
            priority: 'high',
            notification: {
                channelId: exports.SHIFT_ALERT_CHANNEL_ID,
                sound: 'default',
                priority: 'high',
            },
        },
        apns: {
            headers: {
                'apns-priority': '10',
                'apns-push-type': 'alert',
            },
            payload: {
                aps: {
                    sound: 'default',
                    'interruption-level': 'time-sensitive',
                },
            },
        },
    };
}
//# sourceMappingURL=shiftAlertFcm.js.map
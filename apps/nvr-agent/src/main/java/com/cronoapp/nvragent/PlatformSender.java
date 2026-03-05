package com.cronoapp.nvragent;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Envía eventos de alarma a la plataforma por POST HTTPS.
 */
public class PlatformSender {
    private final Config config;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "platform-sender");
        t.setDaemon(true);
        return t;
    });
    private ScheduledFuture<?> heartbeatTask;

    public PlatformSender(Config config) {
        this.config = config;
    }

    /** Inicia el envío periódico de heartbeat (keepalive) si platform.heartbeat.interval.seconds > 0. */
    public void startHeartbeatIfConfigured() {
        if (config.heartbeatIntervalSeconds <= 0) return;
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "platform-heartbeat");
            t.setDaemon(true);
            return t;
        });
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
            try {
                sendHeartbeat();
            } catch (Exception e) {
                System.err.println("[PlatformSender] Error enviando heartbeat: " + e.getMessage());
            }
        }, config.heartbeatIntervalSeconds, config.heartbeatIntervalSeconds, TimeUnit.SECONDS);
        System.out.println("[PlatformSender] Heartbeat cada " + config.heartbeatIntervalSeconds + " s.");
    }

    /**
     * Envía un evento de forma asíncrona (no bloquea el callback del SDK).
     * Si event.types.include está configurado, solo se envían los tipos listados (ej. sin MOTION_EX).
     */
    public void sendEvent(int eventType, int channel, String status, byte[] rawData) {
        String eventTypeName = eventTypeName(eventType);
        if (!config.eventTypesInclude.isEmpty() && !config.eventTypesInclude.contains(eventTypeName.toUpperCase())) {
            System.out.println("[PlatformSender] Evento omitido (no en lista): " + eventTypeName + " ch=" + channel + " " + status);
            return;
        }
        executor.submit(() -> {
            try {
                doSend(eventType, channel, status, rawData);
            } catch (Exception e) {
                System.err.println("[PlatformSender] Error enviando evento: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }

    /** Envía un heartbeat/keepalive a la plataforma (mismo URL, body con type=heartbeat). */
    public void sendHeartbeat() throws Exception {
        String body = buildHeartbeatJson();
        int code = doPost(body);
        if (code >= 200 && code < 300) {
            System.out.println("[PlatformSender] Heartbeat enviado.");
        }
    }

    private void doSend(int eventType, int channel, String status, byte[] rawData) throws Exception {
        String eventTypeName = eventTypeName(eventType);
        String body = buildJson(eventType, eventTypeName, channel, status, rawData);
        int code = doPost(body);
        if (code >= 200 && code < 300) {
            System.out.println("[PlatformSender] Evento enviado: " + eventTypeName + " ch=" + channel + " " + status);
        }
    }

    /** Realiza el POST y devuelve el código HTTP. */
    private int doPost(String body) throws Exception {
        URL url = new URL(config.platformUrl);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            if (config.platformKey != null && !config.platformKey.isEmpty()) {
                conn.setRequestProperty("X-API-Key", config.platformKey);
                conn.setRequestProperty("Authorization", "Bearer " + config.platformKey);
            }
            conn.setDoOutput(true);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                System.err.println("[PlatformSender] Respuesta " + code + " desde " + config.platformUrl);
            }
            return code;
        } finally {
            conn.disconnect();
        }
    }

    private String buildHeartbeatJson() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"source\":\"nvr-agent\",\"type\":\"heartbeat\",\"nvrId\":\"").append(escape(config.nvrId)).append("\"");
        if (config.nvrName != null) {
            sb.append(",\"nvrName\":\"").append(escape(config.nvrName)).append("\"");
        }
        sb.append(",\"timestamp\":\"").append(Instant.now().toString()).append("\"}");
        return sb.toString();
    }

    private String buildJson(int eventType, String eventTypeName, int channel, String status, byte[] rawData) {
        String channelName = getChannelName(channel);
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"nvrId\":\"").append(escape(config.nvrId)).append("\",");
        if (config.nvrName != null) {
            sb.append("\"nvrName\":\"").append(escape(config.nvrName)).append("\",");
        }
        sb.append("\"channel\":").append(channel).append(",");
        if (channelName != null) {
            sb.append("\"channelName\":\"").append(escape(channelName)).append("\",");
        }
        sb.append("\"eventType\":").append(eventType).append(",");
        sb.append("\"eventTypeName\":\"").append(escape(eventTypeName)).append("\",");
        sb.append("\"status\":\"").append(escape(status)).append("\",");
        sb.append("\"timestamp\":\"").append(Instant.now().toString()).append("\",");
        sb.append("\"source\":\"nvr-agent\"");
        if (rawData != null && rawData.length > 0 && rawData.length <= 64) {
            sb.append(",\"channelMask\":[");
            for (int i = 0; i < rawData.length; i++) {
                if (i > 0) sb.append(",");
                sb.append(rawData[i] & 0xFF);
            }
            sb.append("]");
        }
        sb.append("}");
        return sb.toString();
    }

    private String getChannelName(int channel) {
        if (config.channelNames != null && channel >= 0 && channel < config.channelNames.length) {
            String n = config.channelNames[channel];
            if (n != null && !n.trim().isEmpty()) return n.trim();
        }
        return null;
    }

    private static String eventTypeName(int type) {
        switch (type) {
            case 0x2101: return "ALARM_EX";
            case 0x2102: return "MOTION_EX";
            case 0x2103: return "VIDEOLOST_EX";
            case 0x2104: return "SHELTER_EX";
            case 0x2106: return "DISKFULL_EX";
            case 0x2107: return "DISKERROR_EX";
            case 0x2189: return "SMART_EX";   // Evento inteligente NVR (ej. IVS)
            case 0x218f: return "SMART_EX";   // Eventos inteligentes NVR (contorno humano, detección smart)
            case 0x3016: return "SMART_EXT_EX";
            default: return "0x" + Integer.toHexString(type);
        }
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
    }

    public void shutdown() {
        executor.shutdown();
    }
}

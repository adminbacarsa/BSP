package com.cronoapp.nvragent;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;

/**
 * Configuración del agente: NVR (IP, puerto, usuario, contraseña, nvrId, nombre) y URL de la plataforma.
 * Opcional: nombre para mostrar del NVR y nombres por canal, para que la data sea más significativa.
 * Se carga desde config.properties o variables de entorno.
 */
public class Config {
    public final String nvrIp;
    public final int nvrPort;
    public final String nvrUser;
    public final String nvrPassword;
    /** Identificador del NVR en la plataforma (debe coincidir con Cámaras NVR en CronoApp). */
    public final String nvrId;
    /** Nombre para mostrar del NVR (ej. "NVR Portería"). Opcional. */
    public final String nvrName;
    /** Nombres por canal (índice 0 = canal 0). Opcional; si no hay, se usa "Canal N". */
    public final String[] channelNames;
    /** URL a la que enviar eventos (Cloud Function o API). */
    public final String platformUrl;
    /** Clave opcional para autorizar el request. */
    public final String platformKey;
    /** Tipos de evento a enviar a la plataforma (whitelist). Vacío = enviar todos. Ej: VIDEOLOST_EX,ALARM_EX (sin MOTION_EX). */
    public final Set<String> eventTypesInclude;
    /** Intervalo en segundos para enviar heartbeat/keepalive (0 = desactivado). */
    public final int heartbeatIntervalSeconds;
    /** URL del servidor túnel para video en vivo (ej. wss://tunnel-xxx.run.app). Opcional. */
    public final String platformTunnelUrl;

    public Config(String nvrIp, int nvrPort, String nvrUser, String nvrPassword,
                  String nvrId, String nvrName, String[] channelNames,
                  String platformUrl, String platformKey,
                  Set<String> eventTypesInclude, int heartbeatIntervalSeconds,
                  String platformTunnelUrl) {
        this.nvrIp = nvrIp;
        this.nvrPort = nvrPort;
        this.nvrUser = nvrUser;
        this.nvrPassword = nvrPassword;
        this.nvrId = nvrId != null ? nvrId : "default";
        this.nvrName = (nvrName != null && !nvrName.trim().isEmpty()) ? nvrName.trim() : null;
        this.channelNames = channelNames != null ? channelNames : new String[0];
        this.platformUrl = platformUrl;
        this.platformKey = platformKey;
        this.eventTypesInclude = eventTypesInclude != null ? eventTypesInclude : Collections.<String>emptySet();
        this.heartbeatIntervalSeconds = heartbeatIntervalSeconds >= 0 ? heartbeatIntervalSeconds : 0;
        this.platformTunnelUrl = (platformTunnelUrl != null && !platformTunnelUrl.trim().isEmpty()) ? platformTunnelUrl.trim() : null;
    }

    /** Carga desde config.properties del directorio actual. */
    public static Config load() throws Exception {
        return load("config.properties");
    }

    /**
     * Carga desde el archivo indicado (p. ej. para varias NVR: un proceso por NVR con config/nvr1.properties, config/nvr2.properties).
     */
    public static Config load(String configPath) throws Exception {
        Properties p = new Properties();
        File props = new File(configPath);
        if (props.exists()) {
            InputStream is = Files.newInputStream(props.toPath());
            try {
                p.load(is);
            } finally {
                is.close();
            }
        }
        String ip = getEnvOrProp(p, "NVR_IP", "nvr.ip", "192.168.0.102");
        int port = Integer.parseInt(getEnvOrProp(p, "NVR_PORT", "nvr.port", "37777"));
        String user = getEnvOrProp(p, "NVR_USER", "nvr.user", "admin");
        String pass = getEnvOrProp(p, "NVR_PASSWORD", "nvr.password", "");
        String nvrId = getEnvOrProp(p, "NVR_ID", "nvr.id", "default");
        String nvrName = getEnvOrProp(p, "NVR_NAME", "nvr.name", "");
        String channelNamesStr = getEnvOrProp(p, "CHANNEL_NAMES", "channel.names", "");
        String[] channelNames = parseChannelNames(channelNamesStr);
        String url = getEnvOrProp(p, "PLATFORM_URL", "platform.url", "");
        String key = getEnvOrProp(p, "PLATFORM_KEY", "platform.key", "");
        String includeStr = getEnvOrProp(p, "EVENT_TYPES_INCLUDE", "event.types.include", "");
        int heartbeat = 0;
        String hbStr = getEnvOrProp(p, "HEARTBEAT_INTERVAL_SECONDS", "platform.heartbeat.interval.seconds", "0");
        try {
            heartbeat = Integer.parseInt(hbStr.trim());
        } catch (NumberFormatException ignored) { }
        String tunnelUrl = getEnvOrProp(p, "PLATFORM_TUNNEL_URL", "platform.tunnel_url", "");

        if (url == null || url.isEmpty()) {
            throw new IllegalStateException("Falta platform.url o PLATFORM_URL (URL de la Cloud Function o API).");
        }
        Set<String> eventTypesInclude = parseEventTypesInclude(includeStr);
        return new Config(ip, port, user, pass, nvrId, nvrName, channelNames, url.trim(), key != null ? key : "", eventTypesInclude, heartbeat, tunnelUrl);
    }

    /** event.types.include: lista separada por comas, ej. "VIDEOLOST_EX,SHELTER_EX,ALARM_EX". Vacío = enviar todos. */
    private static Set<String> parseEventTypesInclude(String s) {
        if (s == null || s.trim().isEmpty()) return Collections.emptySet();
        Set<String> set = new HashSet<>();
        for (String part : s.split(",")) {
            String t = part.trim().toUpperCase();
            if (!t.isEmpty()) set.add(t);
        }
        return set;
    }

    /** Parsea channel.names (coma separada): "Entrada,Hall,Estacionamiento" -> ["Entrada","Hall","Estacionamiento"] */
    private static String[] parseChannelNames(String s) {
        if (s == null || s.trim().isEmpty()) return new String[0];
        List<String> list = new ArrayList<>();
        for (String part : s.split(",")) {
            String t = part.trim();
            if (!t.isEmpty()) list.add(t);
        }
        return list.toArray(new String[0]);
    }

    private static String getEnvOrProp(Properties p, String envKey, String propKey, String defaultValue) {
        String v = System.getenv(envKey);
        if (v != null && !v.isEmpty()) return v;
        v = p.getProperty(propKey);
        return v != null ? v : defaultValue;
    }
}

package com.cronoapp.nvragent;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Cliente del túnel saliente para video en vivo.
 * Conecta al servidor túnel, se autentica y, al recibir start_stream, envía frames JPEG (snapshot HTTP del NVR) por el WebSocket.
 */
public class TunnelClient extends WebSocketClient {

    private final Config config;
    private volatile boolean authenticated;
    private volatile int streamingChannel = -1;
    private volatile boolean streamRunning;
    private Thread streamThread;

    public TunnelClient(URI serverUri, Config config) {
        super(serverUri);
        this.config = config;
        this.authenticated = false;
    }

    @Override
    public void onOpen(ServerHandshake handshakedata) {
        System.out.println("[Tunnel] Conectado al servidor túnel.");
        String auth = String.format(
            "{\"type\":\"auth\",\"nvrId\":\"%s\",\"agent_secret\":\"%s\"}",
            escapeJson(config.nvrId),
            escapeJson(config.platformKey)
        );
        send(auth);
    }

    @Override
    public void onMessage(String message) {
        try {
            if (message.contains("\"type\":\"auth_ok\"")) {
                authenticated = true;
                System.out.println("[Tunnel] Autenticado. Listo para stream.");
                return;
            }
            if (message.contains("\"type\":\"auth_fail\"")) {
                System.err.println("[Tunnel] Auth fallida: " + message);
                return;
            }
            if (message.contains("\"type\":\"start_stream\"")) {
                int ch = parseChannel(message);
                if (ch >= 1) startStream(ch);
                return;
            }
            if (message.contains("\"type\":\"stop_stream\"")) {
                int ch = parseChannel(message);
                if (ch >= 1) stopStream(ch);
                return;
            }
            if (message.contains("\"type\":\"get_snapshot\"")) {
                int ch = parseChannel(message);
                String requestId = parseRequestId(message);
                if (ch >= 1 && requestId != null && !requestId.isEmpty()) {
                    new Thread(() -> sendSnapshotResponse(ch, requestId), "tunnel-snapshot").start();
                }
            }
        } catch (Exception e) {
            System.err.println("[Tunnel] Error procesando mensaje: " + e.getMessage());
        }
    }

    private void sendSnapshotResponse(int channel1Based, String requestId) {
        try {
            int httpPort = 80;
            String snapshotUrl = String.format("http://%s:%d/cgi-bin/snapshot.cgi?channel=%d", config.nvrIp, httpPort, channel1Based);
            byte[] jpeg = fetchSnapshot(snapshotUrl);
            String imageBase64 = (jpeg != null && jpeg.length > 0) ? Base64.getEncoder().encodeToString(jpeg) : "";
            String json = String.format("{\"type\":\"snapshot_response\",\"requestId\":\"%s\",\"imageBase64\":\"%s\"}",
                escapeJson(requestId), escapeJson(imageBase64));
            if (isOpen()) send(json);
        } catch (Exception e) {
            System.err.println("[Tunnel] get_snapshot error: " + e.getMessage());
            try {
                String json = String.format("{\"type\":\"snapshot_response\",\"requestId\":\"%s\",\"imageBase64\":\"\"}", escapeJson(requestId));
                if (isOpen()) send(json);
            } catch (Exception ignored) {}
        }
    }

    private static String parseRequestId(String json) {
        try {
            int i = json.indexOf("\"requestId\":\"");
            if (i < 0) return null;
            int start = i + 14;
            int end = json.indexOf("\"", start);
            if (end < 0) return null;
            return json.substring(start, end);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        authenticated = false;
        stopStream(streamingChannel);
        System.out.println("[Tunnel] Cerrado: " + code + " " + reason);
    }

    @Override
    public void onError(Exception ex) {
        System.err.println("[Tunnel] Error: " + ex.getMessage());
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static int parseChannel(String json) {
        try {
            int i = json.indexOf("\"channel\":");
            if (i < 0) return -1;
            int start = i + 10;
            int end = json.indexOf(",", start);
            if (end < 0) end = json.indexOf("}", start);
            if (end < 0) return -1;
            return Integer.parseInt(json.substring(start, end).trim());
        } catch (Exception e) {
            return -1;
        }
    }

    private void startStream(int channel) {
        if (streamingChannel == channel && streamRunning) return;
        stopStream(streamingChannel);
        streamingChannel = channel;
        streamRunning = true;
        streamThread = new Thread(() -> runSnapshotLoop(channel), "tunnel-stream-" + channel);
        streamThread.setDaemon(true);
        streamThread.start();
        System.out.println("[Tunnel] Iniciando stream canal " + channel);
    }

    private void stopStream(int channel) {
        if (channel < 0) return;
        streamRunning = false;
        if (streamThread != null) {
            try {
                streamThread.interrupt();
                streamThread.join(2000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            streamThread = null;
        }
        if (streamingChannel == channel) streamingChannel = -1;
        System.out.println("[Tunnel] Stream canal " + channel + " detenido.");
    }

    private void runSnapshotLoop(int channel) {
        // Dahua: HTTP en puerto 80 por defecto para snapshot
        int httpPort = 80;
        String snapshotUrl = String.format("http://%s:%d/cgi-bin/snapshot.cgi?channel=%d", config.nvrIp, httpPort, channel);
        while (streamRunning && streamingChannel == channel && isOpen()) {
            try {
                byte[] jpeg = fetchSnapshot(snapshotUrl);
                if (jpeg != null && jpeg.length > 0 && isOpen()) send(jpeg);
            } catch (Exception e) {
                if (streamRunning) System.err.println("[Tunnel] Snapshot error: " + e.getMessage());
            }
            try {
                Thread.sleep(150);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }

    private byte[] fetchSnapshot(String urlString) throws Exception {
        URL url = new URL(urlString);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        String auth = config.nvrUser + ":" + (config.nvrPassword != null ? config.nvrPassword : "");
        String encoded = Base64.getEncoder().encodeToString(auth.getBytes(StandardCharsets.UTF_8));
        conn.setRequestProperty("Authorization", "Basic " + encoded);
        conn.setRequestMethod("GET");
        int code = conn.getResponseCode();
        if (code != 200) return null;
        InputStream in = conn.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    public void shutdown() {
        streamRunning = false;
        stopStream(streamingChannel);
        close();
    }
}

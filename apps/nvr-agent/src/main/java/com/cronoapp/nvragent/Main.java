package com.cronoapp.nvragent;

import com.netsdk.lib.NetSDKLib;
import com.netsdk.lib.NetSDKLib.LLong;
import com.netsdk.lib.ToolKits;
import com.netsdk.demo.module.AlarmListenModule;
import com.netsdk.demo.module.LoginModule;
import com.sun.jna.Pointer;

import java.net.URI;

/**
 * Punto de entrada del agente NVR.
 * Inicializa el SDK, hace login al NVR, suscribe alarmas y envía cada evento a la plataforma.
 */
public class Main {

    public static void main(String[] args) {
        String configPath = (args != null && args.length > 0 && args[0] != null && !args[0].isEmpty())
                ? args[0] : null;
        Config config;
        try {
            config = configPath != null ? Config.load(configPath) : Config.load();
        } catch (Exception e) {
            System.err.println("Error cargando config: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
            return;
        }

        System.out.println("NVR Agent - Conectando a " + config.nvrIp + ":" + config.nvrPort + " (nvrId=" + config.nvrId + ")");
        System.out.println("Plataforma: " + config.platformUrl);
        if (config.eventTypesInclude.isEmpty()) {
            System.out.println("Eventos a enviar: TODOS (sin filtro)");
        } else {
            System.out.println("Eventos a enviar: " + String.join(", ", config.eventTypesInclude) + " (el resto se omite)");
        }

        NetSDKLib.fDisConnect disConnect = (LLong h, String ip, int port, Pointer user) ->
                System.out.println("[SDK] Desconectado: " + ip + ":" + port);

        NetSDKLib.fHaveReConnect haveReConnect = (LLong h, String ip, int port, Pointer user) ->
                System.out.println("[SDK] Reconectado: " + ip + ":" + port);

        if (!LoginModule.init(disConnect, haveReConnect)) {
            System.err.println("No se pudo inicializar el NetSDK. Revisá que las DLL estén en java.library.path (libs/win64 o libs/linux64).");
            System.exit(1);
            return;
        }

        if (!LoginModule.login(config.nvrIp, config.nvrPort, config.nvrUser, config.nvrPassword)) {
            System.err.println("Login fallido: " + ToolKits.getErrorCodePrint());
            LoginModule.cleanup();
            System.exit(1);
            return;
        }

        PlatformSender sender = new PlatformSender(config);
        sender.startHeartbeatIfConfigured();

        TunnelClient tunnelClient = null;
        if (config.platformTunnelUrl != null && config.platformKey != null && !config.platformKey.isEmpty()) {
            try {
                String tunnelPath = config.platformTunnelUrl.replaceFirst("^https?://", "").replaceFirst("^ws(s)?://", "");
                String scheme = config.platformTunnelUrl.startsWith("https") || config.platformTunnelUrl.startsWith("wss") ? "wss" : "ws";
                URI tunnelUri = new URI(scheme + "://" + tunnelPath + (tunnelPath.endsWith("/") ? "agent" : "/agent"));
                tunnelClient = new TunnelClient(tunnelUri, config);
                tunnelClient.connect();
                System.out.println("Túnel de vivo: " + tunnelUri);
            } catch (Exception e) {
                System.err.println("No se pudo iniciar túnel de vivo: " + e.getMessage());
            }
        }

        AlarmCallback alarmCb = new AlarmCallback(sender);
        if (!AlarmListenModule.startListen(alarmCb)) {
            System.err.println("No se pudo suscribir a alarmas.");
            LoginModule.logout();
            LoginModule.cleanup();
            sender.shutdown();
            System.exit(1);
            return;
        }

        System.out.println("Agente en marcha. Recibiendo alarmas y enviando a la plataforma. Ctrl+C para salir.");

        final TunnelClient tunnel = tunnelClient;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Cerrando agente...");
            if (tunnel != null) tunnel.shutdown();
            AlarmListenModule.stopListen();
            LoginModule.logout();
            LoginModule.cleanup();
            sender.shutdown();
        }));

        try {
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

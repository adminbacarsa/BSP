package com.cronoapp.nvragent;

import com.netsdk.lib.NetSDKLib;
import com.netsdk.lib.NetSDKLib.LLong;
import com.sun.jna.NativeLong;
import com.sun.jna.Pointer;

/**
 * Callback de alarmas del NetSDK: recibe eventos (canal, tipo) y los envia a la plataforma.
 */
public class AlarmCallback implements NetSDKLib.fMessCallBack {
    private static final int NET_ALARM_ALARM_EX = 0x2101;
    private static final int NET_MOTION_ALARM_EX = 0x2102;
    private static final int NET_VIDEOLOST_ALARM_EX = 0x2103;
    private static final int NET_SHELTER_ALARM_EX = 0x2104;
    private static final int NET_DISKFULL_ALARM_EX = 0x2106;
    private static final int NET_DISKERROR_ALARM_EX = 0x2107;

    private final PlatformSender sender;

    public AlarmCallback(PlatformSender sender) {
        this.sender = sender;
    }

    @Override
    public boolean invoke(int lCommand, LLong lLoginID, Pointer pStuEvent, int dwBufLen,
            String strDeviceIP, NativeLong nDevicePort, Pointer dwUser) {
        switch (lCommand) {
            case NET_ALARM_ALARM_EX:
            case NET_MOTION_ALARM_EX:
            case NET_VIDEOLOST_ALARM_EX:
            case NET_SHELTER_ALARM_EX:
            case NET_DISKFULL_ALARM_EX:
            case NET_DISKERROR_ALARM_EX:
                if (pStuEvent != null && dwBufLen > 0) {
                    byte[] alarm = new byte[dwBufLen];
                    pStuEvent.read(0, alarm, 0, dwBufLen);
                    for (int ch = 0; ch < dwBufLen; ch++) {
                        String status = (alarm[ch] == 1) ? "start" : "stop";
                        System.out.println("[NVR] Evento recibido: " + eventTypeName(lCommand) + " canal=" + ch + " " + status);
                        sender.sendEvent(lCommand, ch, status, alarm);
                    }
                }
                break;
            default:
                System.out.println("[NVR] Evento recibido: tipo=0x" + Integer.toHexString(lCommand));
                sender.sendEvent(lCommand, -1, "event", null);
                break;
        }
        return true;
    }

    private static String eventTypeName(int type) {
        switch (type) {
            case 0x2101: return "ALARM_EX";
            case 0x2102: return "MOTION_EX";
            case 0x2103: return "VIDEOLOST_EX";
            case 0x2104: return "SHELTER_EX";
            case 0x2106: return "DISKFULL_EX";
            case 0x2107: return "DISKERROR_EX";
            case 0x2189: return "SMART_EX";
            case 0x218f: return "SMART_EX";
            case 0x3016: return "SMART_EXT_EX";
            default: return "0x" + Integer.toHexString(type);
        }
    }
}

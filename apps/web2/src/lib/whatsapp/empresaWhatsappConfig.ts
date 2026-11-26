/**
 * Config WhatsApp por empresa: Bridge (Baileys) o Cloud API (Meta), uno activo.
 * Doc: empresas/{empresaId}/config/whatsapp
 * Legacy: empresas/{empresaId}/config/wa-bridge { url } → se trata como provider bridge.
 */

export type WhatsAppProvider = 'off' | 'bridge' | 'cloud';

export type WhatsAppCloudTemplates = {
  presenteOk: string;
  fueraDeRadio: string;
  salidaOk: string;
  salidaAntesDeFin: string;
};

export type EmpresaWhatsAppConfig = {
  provider: WhatsAppProvider;
  bridge: { url: string };
  cloud: {
    phoneNumberId: string;
    wabaId: string;
    displayPhone: string;
    /** Solo metadato: el token vive en Admin SDK (empresa_wa_cloud_credentials). */
    tokenConfigured: boolean;
    templates: WhatsAppCloudTemplates;
  };
};

export const WHATSAPP_TEMPLATES_DEFAULT: WhatsAppCloudTemplates = {
  presenteOk: '',
  fueraDeRadio: '',
  salidaOk: '',
  salidaAntesDeFin: '',
};

export function emptyWhatsAppConfig(): EmpresaWhatsAppConfig {
  return {
    provider: 'off',
    bridge: { url: '' },
    cloud: {
      phoneNumberId: '',
      wabaId: '',
      displayPhone: '',
      tokenConfigured: false,
      templates: { ...WHATSAPP_TEMPLATES_DEFAULT },
    },
  };
}

export function parseWhatsAppConfig(raw: unknown): EmpresaWhatsAppConfig {
  const base = emptyWhatsAppConfig();
  if (!raw || typeof raw !== 'object') return base;
  const d = raw as Record<string, unknown>;
  const providerRaw = String(d.provider || '').toLowerCase();
  const provider: WhatsAppProvider =
    providerRaw === 'bridge' || providerRaw === 'cloud' || providerRaw === 'off'
      ? providerRaw
      : 'off';
  const bridge = (d.bridge && typeof d.bridge === 'object' ? d.bridge : {}) as Record<string, unknown>;
  const cloud = (d.cloud && typeof d.cloud === 'object' ? d.cloud : {}) as Record<string, unknown>;
  const templatesRaw =
    cloud.templates && typeof cloud.templates === 'object'
      ? (cloud.templates as Record<string, unknown>)
      : {};
  return {
    provider,
    bridge: { url: typeof bridge.url === 'string' ? bridge.url.trim() : '' },
    cloud: {
      phoneNumberId: typeof cloud.phoneNumberId === 'string' ? cloud.phoneNumberId.trim() : '',
      wabaId: typeof cloud.wabaId === 'string' ? cloud.wabaId.trim() : '',
      displayPhone: typeof cloud.displayPhone === 'string' ? cloud.displayPhone.trim() : '',
      tokenConfigured: cloud.tokenConfigured === true,
      templates: {
        presenteOk: typeof templatesRaw.presenteOk === 'string' ? templatesRaw.presenteOk.trim() : '',
        fueraDeRadio:
          typeof templatesRaw.fueraDeRadio === 'string' ? templatesRaw.fueraDeRadio.trim() : '',
        salidaOk: typeof templatesRaw.salidaOk === 'string' ? templatesRaw.salidaOk.trim() : '',
        salidaAntesDeFin:
          typeof templatesRaw.salidaAntesDeFin === 'string'
            ? templatesRaw.salidaAntesDeFin.trim()
            : '',
      },
    },
  };
}

/** Une el doc nuevo con el legacy `wa-bridge` si hace falta. */
export function mergeLegacyBridgeUrl(
  cfg: EmpresaWhatsAppConfig,
  legacyUrl: string | undefined,
): EmpresaWhatsAppConfig {
  const url = (legacyUrl || '').trim();
  if (!url) return cfg;
  if (cfg.bridge.url) return cfg;
  return {
    ...cfg,
    provider: cfg.provider === 'off' ? 'bridge' : cfg.provider,
    bridge: { url },
  };
}

export function whatsappConfigWritablePayload(cfg: EmpresaWhatsAppConfig): Record<string, unknown> {
  return {
    provider: cfg.provider,
    bridge: { url: cfg.bridge.url.trim() },
    cloud: {
      phoneNumberId: cfg.cloud.phoneNumberId.trim(),
      wabaId: cfg.cloud.wabaId.trim(),
      displayPhone: cfg.cloud.displayPhone.trim(),
      tokenConfigured: cfg.cloud.tokenConfigured === true,
      templates: {
        presenteOk: cfg.cloud.templates.presenteOk.trim(),
        fueraDeRadio: cfg.cloud.templates.fueraDeRadio.trim(),
        salidaOk: cfg.cloud.templates.salidaOk.trim(),
        salidaAntesDeFin: cfg.cloud.templates.salidaAntesDeFin.trim(),
      },
    },
  };
}

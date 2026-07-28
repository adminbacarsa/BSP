import Constants from 'expo-constants';
import type { PortalCoreConfig } from '@cosp/portal-core';

type ExpoExtra = {
  useEmulator?: boolean;
  emulatorHost?: string;
  firebase?: PortalCoreConfig['firebase'];
};

function getExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

export function getPortalCoreConfig(): PortalCoreConfig {
  const extra = getExtra();
  return {
    firebase: {
      apiKey: extra.firebase?.apiKey ?? '',
      authDomain: extra.firebase?.authDomain ?? '',
      projectId: extra.firebase?.projectId ?? '',
      storageBucket: extra.firebase?.storageBucket ?? '',
      messagingSenderId: extra.firebase?.messagingSenderId ?? '',
      appId: extra.firebase?.appId ?? '',
    },
    useEmulator: extra.useEmulator === true,
    emulatorHost: extra.emulatorHost,
    functionsRegion: 'us-central1',
  };
}

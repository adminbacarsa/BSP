import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'COSP Guardia',
  slug: 'cosp-guardia',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'cosp-guardia',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.grupobacar.cosp.guardia',
  },
  android: {
    package: 'com.grupobacar.cosp.guardia',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#312e81',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    useEmulator: process.env.EXPO_PUBLIC_USE_EMULATOR === 'true',
    emulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1',
    firebase: {
      apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
    },
  },
};

export default config;

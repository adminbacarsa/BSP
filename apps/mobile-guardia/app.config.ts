import type { ExpoConfig } from 'expo/config';

const useEmulator = process.env.EXPO_PUBLIC_USE_EMULATOR === 'true';

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
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'COSP Guardia usa tu ubicación para validar la fichada en el puesto de trabajo.',
      NSCameraUsageDescription:
        'COSP Guardia usa la cámara para adjuntar certificados médicos a tus novedades.',
      NSPhotoLibraryUsageDescription:
        'COSP Guardia accede a tus fotos para adjuntar certificados a novedades de ausencia.',
    },
  },
  android: {
    package: 'com.grupobacar.cosp.guardia',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
    ...(useEmulator ? { usesCleartextTraffic: true } : {}),
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#312e81',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-asset',
    'expo-font',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'COSP Guardia necesita tu ubicación para validar que estás en el puesto al marcar presente.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'COSP Guardia accede a tus fotos para adjuntar certificados a novedades de ausencia.',
        cameraPermission:
          'COSP Guardia usa la cámara para adjuntar certificados médicos a tus novedades.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/android-icon-foreground.png',
        color: '#312e81',
        defaultChannel: 'default',
        sounds: [],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: '79b445af-b6a7-456b-b1be-87cf25a20bd5',
    },
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

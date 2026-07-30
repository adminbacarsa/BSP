import * as Device from 'expo-device';
import { Dimensions, Platform } from 'react-native';
import { getMobilePlatform } from './deviceId';

export function getDeviceInfo(): Record<string, string> {
  const { width, height } = Dimensions.get('window');
  return {
    platform: getMobilePlatform(),
    osName: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion ?? '',
    modelName: Device.modelName ?? '',
    brand: Device.brand ?? '',
    screenW: String(Math.round(width)),
    screenH: String(Math.round(height)),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

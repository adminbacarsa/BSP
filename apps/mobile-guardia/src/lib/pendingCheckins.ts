import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_CHECKINS_STORAGE_KEY,
  parsePendingCheckins,
  type PendingCheckInItem,
} from '@cosp/portal-core';

export async function loadPendingCheckins(): Promise<PendingCheckInItem[]> {
  const raw = await AsyncStorage.getItem(PENDING_CHECKINS_STORAGE_KEY);
  return parsePendingCheckins(raw);
}

export async function savePendingCheckins(list: PendingCheckInItem[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_CHECKINS_STORAGE_KEY, JSON.stringify(list));
}

export async function enqueuePendingCheckin(item: PendingCheckInItem): Promise<void> {
  const list = await loadPendingCheckins();
  list.push(item);
  await savePendingCheckins(list);
}

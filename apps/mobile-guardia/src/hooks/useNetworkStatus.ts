import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type NetworkStatus = {
  isOffline: boolean;
  checked: boolean;
};

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({ isOffline: false, checked: false });

  useEffect(() => {
    const apply = (state: NetInfoState) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      setStatus({ isOffline: !connected, checked: true });
    };
    NetInfo.fetch().then(apply);
    const unsub = NetInfo.addEventListener(apply);
    return () => unsub();
  }, []);

  return status;
}

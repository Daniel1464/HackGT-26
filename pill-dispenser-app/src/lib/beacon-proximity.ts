import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

export type BeaconStatus = {
  enabled: boolean;
  state: 'inside' | 'outside' | 'unknown';
  observedAt: number;
  permission: string;
  backgroundAvailable: boolean;
  error: string;
};
type BeaconModule = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<BeaconStatus>;
};
const native = requireOptionalNativeModule<BeaconModule>('TimedBeacon');
function requireBeacon() {
  if (!native) throw new Error('Beacon monitoring requires a rebuilt native app; it is unavailable in Expo Go or the browser.');
  return native;
}
export const getBeaconStatus = async () => requireBeacon().getStatus();
export const stopBeaconMonitoring = async () => requireBeacon().stop();
export async function startBeaconMonitoring() {
  const beacon = requireBeacon();
  if (Platform.OS === 'android') {
    const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];
    if (Number(Platform.Version) >= 31) permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    await PermissionsAndroid.requestMultiple(permissions);
    // Android 11+ requires the user to select “Allow all the time” in Settings.
    if (Number(Platform.Version) === 29) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
  }
  await beacon.start();
}

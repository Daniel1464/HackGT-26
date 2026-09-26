import type { UseBleCounterResult } from '@/lib/ble-counter';

/**
 * Bluetooth Low Energy is not available in the browser, so the web build
 * explains the limitation instead of connecting to the ESP32.
 */
export function useBleCounter(): UseBleCounterResult {
  return {
    status: 'unsupported',
    servoValue: null,
    deviceName: null,
    error: 'Connect the pill dispenser from the iOS or Android build of this app.',
    sendServoValue: () =>
      Promise.reject(new Error('Bluetooth is not available in the browser.')),
    retry: () => {},
  };
}

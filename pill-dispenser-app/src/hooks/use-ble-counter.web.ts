import type { UseBleCounterResult } from '@/lib/ble-counter';

/**
 * Bluetooth Low Energy is not available in the browser, so the web build
 * explains the limitation instead of connecting to the ESP32.
 */
export function useBleCounter(): UseBleCounterResult {
  return {
    status: 'unsupported',
    sendMedicine: async () => { throw new Error('Use the native app for Bluetooth transfer.'); },
    getMedicineIdForName: async () => { throw new Error('Use the native app to read medicine names over Bluetooth.'); },
    getMedicationNames: async () => { throw new Error('Use the native app to read medicine names over Bluetooth.'); },
    saveMedicineName: async () => { throw new Error('Use the native app to save medicine names over Bluetooth.'); },
    removeMedicineSchedule: async () => { throw new Error('Use the native app to remove medication over Bluetooth.'); },
    servoValue: null,
    deviceName: null,
    error: 'Connect the pill dispenser from the iOS or Android build of this app.',
    sendServoValue: () =>
      Promise.reject(new Error('Bluetooth is not available in the browser.')),
    retry: () => {},
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { fromByteArray } from 'base64-js';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';

import {
  CounterCharacteristicUUID,
  CounterServiceUUIDs,
  TimeCharacteristicUUID,
} from '@/constants/ble';
import {
  encodeServoValue,
  isValidServoValue,
  MAX_SERVO_VALUE,
  MIN_SERVO_VALUE,
  type BleCounterStatus,
  type UseBleCounterResult,
} from '@/lib/ble-counter';

/** How long the service filtered scan runs before the broad scan takes over. */
const FILTERED_SCAN_TIMEOUT_MS = 8_000;
/** How long the broad scan runs before the peripheral is considered missing. */
const BROAD_SCAN_TIMEOUT_MS = 6_000;
/** The firmware rewrites the counter once per second, so poll at the same rate. */
const POLL_INTERVAL_MS = 1_000;
/** Re-sync the ESP32 clock periodically so its millis-based clock stays accurate. */
const TIME_SYNC_INTERVAL_MS = 60_000;
/** iOS reports an unknown Bluetooth state until its stack has finished starting. */
const BLUETOOTH_STATE_TIMEOUT_MS = 5_000;
const BLUETOOTH_STATE_POLL_MS = 250;

/**
 * Everything a single connection attempt owns. Keeping it per attempt means a
 * run that goes stale (unmount, retry) can release only its own resources.
 */
type BleSession = {
  device: Device | null;
  subscriptions: Subscription[];
  /** Writes a Base64 encoded servo angle to the connected peripheral. */
  writeValue: ((valueBase64: string) => Promise<unknown>) | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  timeSyncTimer: ReturnType<typeof setInterval> | null;
};

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}

function isCounterServiceUuid(uuid: string): boolean {
  const candidate = normalizeUuid(uuid);
  return CounterServiceUUIDs.some((serviceUuid) => normalizeUuid(serviceUuid) === candidate);
}

function isCounterCharacteristicUuid(uuid: string): boolean {
  return normalizeUuid(uuid) === normalizeUuid(CounterCharacteristicUUID);
}

function isTimeCharacteristicUuid(uuid: string): boolean {
  return normalizeUuid(uuid) === normalizeUuid(TimeCharacteristicUUID);
}

function encodeAscii(value: string): string {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return fromByteArray(bytes);
}

function advertisesCounterService(device: Device): boolean {
  return (device.serviceUUIDs ?? []).some(isCounterServiceUuid);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function requestBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Android 12 (API 31) replaced the location requirement with the explicit
  // Bluetooth permissions.
  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  const granted = permissions.every(
    (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
  if (!granted) {
    throw new Error('Bluetooth permission is required to read the pill dispenser counter.');
  }
}

async function ensureBluetoothReady(manager: BleManager): Promise<void> {
  const state = await waitForBluetoothState(manager);
  if (state === State.PoweredOn) return;

  if (state === State.Unsupported) {
    throw new Error('This device does not support Bluetooth Low Energy.');
  }
  if (state === State.Unauthorized) {
    throw new Error('Bluetooth access is denied for this app. Enable it in Settings and try again.');
  }
  if (state === State.Unknown) {
    throw new Error('Bluetooth is still starting up. Try again in a moment.');
  }
  if (Platform.OS === 'android') {
    // Shows the system dialog that lets the user turn Bluetooth on.
    await manager.enable();
    return;
  }

  throw new Error('Bluetooth is turned off. Turn it on and try again.');
}

async function waitForBluetoothState(manager: BleManager): Promise<State> {
  const deadline = Date.now() + BLUETOOTH_STATE_TIMEOUT_MS;
  for (;;) {
    const state = await manager.state();
    if (state !== State.Unknown || Date.now() >= deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, BLUETOOTH_STATE_POLL_MS));
  }
}

function scanForDevice(
  manager: BleManager,
  options: {
    serviceUUIDs: string[] | null;
    timeoutMs: number;
    matches: (device: Device) => boolean;
  },
  isStale: () => boolean,
): Promise<Device | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (device: Device | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // A stale run must not stop the scan owned by the run that replaced it.
      if (!isStale()) {
        manager.stopDeviceScan().catch(() => {});
      }
      if (error) {
        reject(error);
      } else {
        resolve(device);
      }
    };

    timer = setTimeout(() => finish(null), options.timeoutMs);

    manager
      .startDeviceScan(options.serviceUUIDs, { allowDuplicates: false }, (error, device) => {
        if (settled) return;
        if (error) {
          finish(null, toError(error));
          return;
        }
        if (isStale()) {
          finish(null);
          return;
        }
        if (device && options.matches(device)) {
          finish(device);
        }
      })
      .catch((error: unknown) => finish(null, toError(error)));
  });
}

/**
 * Connects to the ESP32 pill dispenser and broadcasts servo angles to it. The
 * link is opened on mount and released on unmount.
 */
export function useBleCounter(): UseBleCounterResult {
  const [status, setStatus] = useState<BleCounterStatus>('idle');
  const [servoValue, setServoValue] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(false);
  const runIdRef = useRef(0);
  const managerRef = useRef<BleManager | null>(null);
  const sessionRef = useRef<BleSession | null>(null);

  const disposeSession = useCallback(async (session: BleSession | null) => {
    if (!session) return;

    if (session.pollTimer) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }
    if (session.timeSyncTimer) {
      clearInterval(session.timeSyncTimer);
      session.timeSyncTimer = null;
    }
    for (const subscription of session.subscriptions.splice(0)) {
      subscription.remove();
    }

    const device = session.device;
    session.device = null;
    if (!device) return;

    try {
      if (await device.isConnected()) await device.cancelConnection();
    } catch {
      // The link is already closed; there is nothing left to release.
    }
  }, []);

  const connect = useCallback(async () => {
    const runId = ++runIdRef.current;
    const isStale = () => !aliveRef.current || runIdRef.current !== runId;
    const session: BleSession = {
      device: null,
      subscriptions: [],
      pollTimer: null,
      writeValue: null,
      timeSyncTimer: null,
    };

    await disposeSession(sessionRef.current);
    sessionRef.current = session;
    if (isStale()) return;

    setError(null);
    setStatus('idle');

    try {
      // Only a real unmount destroys the manager, so a stale run may still
      // reuse the manager a newer run just installed.
      if (!aliveRef.current) return;
      if (!managerRef.current) managerRef.current = new BleManager();
      const manager = managerRef.current;

      await requestBluetoothPermissions();
      if (isStale()) return;
      await ensureBluetoothReady(manager);
      if (isStale()) return;

      setStatus('scanning');
      const device =
        (await scanForDevice(
          manager,
          {
            serviceUUIDs: [...CounterServiceUUIDs],
            timeoutMs: FILTERED_SCAN_TIMEOUT_MS,
            matches: () => true,
          },
          isStale,
        )) ??
        (await scanForDevice(
          manager,
          {
            serviceUUIDs: null,
            timeoutMs: BROAD_SCAN_TIMEOUT_MS,
            matches: advertisesCounterService,
          },
          isStale,
        ));

      if (isStale()) return;
      if (!device) {
        throw new Error(
          'No pill dispenser found nearby. Make sure the ESP32 is powered on and in range.',
        );
      }

      setStatus('connecting');
      setDeviceName(device.localName ?? device.name);

      const connected = await device.connect();
      if (isStale()) {
        await disposeSession(session);
        return;
      }
      session.device = connected;

      session.subscriptions.push(
        manager.onDeviceDisconnected(connected.id, (disconnectError) => {
          if (isStale()) return;
          session.writeValue = null;
          session.device = null;
          setStatus('error');
          setError(
            disconnectError
              ? `Lost the Bluetooth connection: ${disconnectError.message}`
              : 'Disconnected from the pill dispenser.',
          );
        }),
      );

      const ready = await connected.discoverAllServicesAndCharacteristics();
      if (isStale()) {
        await disposeSession(session);
        return;
      }

      const serviceUuid = (await ready.services())
        .map((service) => service.uuid)
        .find(isCounterServiceUuid);
      if (!serviceUuid) {
        throw new Error('The connected device does not expose the counter service.');
      }

      const characteristic = (await ready.characteristicsForService(serviceUuid)).find(
        (item) => isCounterCharacteristicUuid(item.uuid),
      );
      if (!characteristic) {
        throw new Error('The connected device does not expose the counter characteristic.');
      }

      const timeCharacteristic = (await ready.characteristicsForService(serviceUuid)).find(
        (item) => isTimeCharacteristicUuid(item.uuid),
      );
      if (!timeCharacteristic) {
        throw new Error('The connected device does not expose the time characteristic.');
      }

      // The firmware reads this characteristic with `getValue<int>()` and
      // feeds the result to `Servo::write()`, so a write is what moves the
      // servo. Writes with a response surface firmware side errors.
      session.writeValue = (valueBase64) =>
        ready.writeCharacteristicWithResponseForService(
          serviceUuid,
          characteristic.uuid,
          valueBase64,
        );

      const readCounter = async () => {
        try {
          const value = await ready.readCharacteristicForService(
            serviceUuid,
            characteristic.uuid,
          );
          if (isStale()) return;
          const parsed = parseCounterValue(value.value);
          if (parsed !== null) setCounter(parsed);
          setError(null);
        } catch (readError) {
          if (isStale()) return;
          setError(`Could not read the counter: ${toError(readError).message}`);
        }
      };

      const syncUtcTime = async () => {
        const utcSeconds = Math.floor(Date.now() / 1_000).toString();
        await ready.writeCharacteristicWithResponseForService(
          serviceUuid,
          timeCharacteristic.uuid,
          encodeAscii(utcSeconds),
        );
      };

      // The firmware only exposes READ on the counter, so polling is what keeps
      // the value fresh. Notifications are used as well when available.
      if (characteristic.isNotifiable || characteristic.isIndicatable) {
        session.subscriptions.push(
          ready.monitorCharacteristicForService(
            serviceUuid,
            characteristic.uuid,
            (notificationError, notified) => {
              if (isStale() || notificationError || !notified) return;
              const parsed = parseCounterValue(notified.value);
              if (parsed !== null) setCounter(parsed);
            },
          ),
        );
      }
      session.pollTimer = setInterval(() => {
        void readCounter();
      }, POLL_INTERVAL_MS);

      await syncUtcTime();
      session.timeSyncTimer = setInterval(() => {
        void syncUtcTime().catch((syncError: unknown) => {
          if (isStale()) return;
          setError(`Could not synchronize the clock: ${toError(syncError).message}`);
        });
      }, TIME_SYNC_INTERVAL_MS);

      setStatus('connected');
    } catch (connectError) {
      await disposeSession(session);
      if (isStale()) return;
      setStatus('error');
      setError(toError(connectError).message);
    }
  }, [disposeSession]);

  useEffect(() => {
    aliveRef.current = true;
    // The link is opened from a scheduled callback: the effect body itself
    // stays free of state updates, so the first frame paints before scanning.
    const timer = setTimeout(() => {
      void connect();
    }, 0);

    return () => {
      clearTimeout(timer);
      aliveRef.current = false;
      runIdRef.current += 1;

      void disposeSession(sessionRef.current);
      sessionRef.current = null;

      const manager = managerRef.current;
      managerRef.current = null;
      manager?.destroy().catch(() => {});
    };
  }, [connect, disposeSession]);

  const sendServoValue = useCallback(async (value: number) => {
    if (!isValidServoValue(value)) {
      throw new Error(
        `Servo angles must be whole numbers between ${MIN_SERVO_VALUE} and ${MAX_SERVO_VALUE}.`,
      );
    }

    const writeValue = sessionRef.current?.writeValue;
    if (!writeValue) {
      throw new Error('Not connected to the pill dispenser yet.');
    }

    await writeValue(encodeServoValue(value));
    if (!aliveRef.current) return;
    setServoValue(value);
  }, []);

  const retry = useCallback(() => {
    void connect();
  }, [connect]);

  return { status, servoValue, deviceName, error, sendServoValue, retry };
}

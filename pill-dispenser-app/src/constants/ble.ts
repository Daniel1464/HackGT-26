/**
 * Bluetooth identifiers of the ESP32 pill dispenser.
 *
 * The pill counter is published on {@link CounterCharacteristicUUID}. The
 * firmware in the companion `pill-dispenser-firmware` project advertises
 * `4fafc201-…`, so both services are accepted until that firmware uses the new
 * UUID.
 */
export const CounterServiceUUIDs = [
  '1BE86AC8-1E66-B862-80E9-B5485092BA10',
  '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
] as const;

export const CounterCharacteristicUUID = '48f7d908-c8b4-4066-a809-c67e4bdb2b86';

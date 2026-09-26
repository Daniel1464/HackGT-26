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

/** Writable characteristic used by the app to synchronize the ESP32 clock. */
export const TimeCharacteristicUUID = '5a84b053-9bfe-4f27-8c2a-c4dce2bf537f';
export const MedicineCharacteristicUUID = '9c8b3e10-74d5-4e36-a5a1-938871102001';
export const MedicineNameCharacteristicUUID = '9c8b3e10-74d5-4e36-a5a1-938871102002';
export const RemoveMedicineCharacteristicUUID = 'd2d13576-fe66-4af5-ad40-17535cc3fd2a';

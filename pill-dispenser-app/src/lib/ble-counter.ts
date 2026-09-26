import { fromByteArray, toByteArray } from 'base64-js';
import type { MedicineRecord } from './medicine';

/** Lifecycle of the Bluetooth link with the ESP32 servo peripheral. */
export type BleCounterStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unsupported';

export type BleCounterState = {
  status: BleCounterStatus;
  /** Servo angle written to the peripheral last, or `null` before the first send. */
  servoValue: number | null;
  /** Name the peripheral advertises, when it is known. */
  deviceName: string | null;
  /** Human readable problem description, set while `status` is `error`. */
  error: string | null;
};

export type UseBleCounterResult = BleCounterState & {
  sendMedicine: (record: MedicineRecord) => Promise<void>;
  getNextMedicineId: () => Promise<0 | 1>;
  removeMedicineSchedule: (medicineID: number) => Promise<void>;
  /** Broadcasts a servo angle over the counter characteristic. */
  sendServoValue: (value: number) => Promise<void>;
  /** Drops the current link and starts looking for the peripheral again. */
  retry: () => void;
};

/** `Servo::write()` takes the angle in whole degrees. */
export const MIN_SERVO_VALUE = 0;
export const MAX_SERVO_VALUE = 180;

/** True for the whole degrees `Servo::write()` understands. */
export function isValidServoValue(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SERVO_VALUE && value <= MAX_SERVO_VALUE;
}

/**
 * Encodes a servo angle for the counter characteristic.
 *
 * The firmware reads the characteristic with `getValue<int>()`, which copies
 * `sizeof(int)` bytes as a little-endian integer, so the angle is sent as a
 * 32 bit little-endian value rather than as text.
 */
export function encodeServoValue(value: number): string {
  const bytes = new Uint8Array(SERVO_VALUE_BYTES);
  for (let index = 0; index < SERVO_VALUE_BYTES; index += 1) {
    bytes[index] = (value >>> (8 * index)) & 0xff;
  }
  return fromByteArray(bytes);
}

/** Width of `int` on the ESP32 the firmware runs on. */
const SERVO_VALUE_BYTES = 4;

/** Longest little-endian integer that still fits into a safe `number`. */
const MAX_INTEGER_BYTES = 6;
const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;
const DECIMAL_COUNTER = /^-?\d+$/;

/**
 * Decodes a Base64 characteristic value into the counter it carries.
 *
 * ESP32 firmware either writes the counter as an ASCII decimal string (`"42"`,
 * sometimes padded with whitespace or a NUL terminator) or as a little-endian
 * unsigned integer. Returns `null` when the payload is neither.
 */
export function parseCounterValue(base64Value: string | null | undefined): number | null {
  if (!base64Value) return null;

  let bytes: Uint8Array;
  try {
    bytes = toByteArray(base64Value);
  } catch {
    return null;
  }

  const decimal = readDecimal(trimPadding(bytes));
  if (decimal !== null) return decimal;

  // Anything that is not padded text is read as an integer over the whole
  // payload: a leading zero byte is the most significant byte of a
  // little-endian number, not padding.
  if (bytes.length === 0 || bytes.length > MAX_INTEGER_BYTES) return null;

  let value = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    value += bytes[index] * 256 ** index;
  }
  return value;
}

function trimPadding(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  while (start < end && isPadding(bytes[start])) start += 1;
  while (end > start && isPadding(bytes[end - 1])) end -= 1;
  return bytes.subarray(start, end);
}

function isPadding(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20;
}

function readDecimal(bytes: Uint8Array): number | null {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte < PRINTABLE_MIN || byte > PRINTABLE_MAX) return null;
    text += String.fromCharCode(byte);
  }
  if (!DECIMAL_COUNTER.test(text)) return null;

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

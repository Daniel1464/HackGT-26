import { type MedicineRecord, validateMedicine } from './medicine';

export type MedicationIdentity = Pick<MedicineRecord, 'medicine' | 'id'>;

/** Dashboard times are local wall-clock times; the existing wire format is UTC. */
export function adaptMedicationSchedule(
  parameters: unknown,
  medications: readonly MedicationIdentity[],
  now = new Date(),
): MedicineRecord {
  if (!parameters || typeof parameters !== 'object') throw new Error('Expected medication parameters.');
  const { medicineName, doses } = parameters as Record<string, unknown>;
  if (typeof medicineName !== 'string' || !medicineName.trim()) {
    throw new Error('medicineName must be a non-empty string.');
  }
  if (!Array.isArray(doses) || doses.length === 0) throw new Error('doses must be a non-empty array.');
  const data = doses.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Each dose must contain time and quantity.');
    const { time, quantity } = entry as Record<string, unknown>;
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error('Each time must use 24-hour HH:MM.');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error('Each quantity must be a positive integer.');
    }
    const [hour, minute] = time.split(':').map(Number);
    const local = new Date(now);
    local.setHours(hour, minute, 0, 0);
    if (local.getHours() !== hour || local.getMinutes() !== minute) {
      throw new Error(`Local time ${time} does not exist today due to a clock change.`);
    }
    return { time: `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} UTC`, dose: quantity };
  });
  const matches = medications.filter(({ medicine }) => medicine.trim().toLowerCase() === medicineName.trim().toLowerCase());
  if (matches.length !== 1 || medications.some((item) => item.id === matches[0]?.id && item !== matches[0])) {
    throw new Error(`Cannot uniquely resolve medication "${medicineName.trim()}" to a configured medication ID.`);
  }
  return validateMedicine({ medicine: matches[0].medicine, id: matches[0].id, data });
}

const SCHEDULE_UNAVAILABLE = 'Medication schedules are stored on the dispenser, but the app has no retained schedule store or BLE schedule readback. The current schedule is unavailable.';

export function createMedicationClientTools(options: {
  connected: boolean;
  medications: readonly MedicationIdentity[];
  sendMedicine: (record: MedicineRecord) => Promise<void>;
  onSaved: (medicineName: string) => void;
  onError: (message: string) => void;
}) {
  function failure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError(message);
    return { success: false as const, error: message };
  }

  return {
    saveMedicationSchedule: async (parameters: unknown) => {
      try {
        const record = adaptMedicationSchedule(parameters, options.medications);
        if (!options.connected) throw new Error('Connect the pill dispenser before saving a schedule.');
        await options.sendMedicine(record);
        options.onSaved(record.medicine);
        return { success: true as const, medicineName: record.medicine };
      } catch (error) {
        return failure(error);
      }
    },
    // Unknown schedules must not be reported as an empty schedule or no upcoming dose.
    getNextMedication: async () => failure(new Error(SCHEDULE_UNAVAILABLE)),
    getMedicationSchedule: async () => failure(new Error(SCHEDULE_UNAVAILABLE)),
  };
}

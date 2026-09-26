import { type MedicineRecord, validateMedicine } from './medicine';

export type MedicationIdentity = Pick<MedicineRecord, 'medicine' | 'id'>;

/** Dashboard times are local wall-clock times; the existing wire format is UTC. */
export function adaptMedicationSchedule(
  parameters: unknown,
  medications: readonly MedicationIdentity[],
  now = new Date(),
  assignedId?: 0 | 1,
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
  if (matches.length === 1) return validateMedicine({ medicine: matches[0].medicine, id: matches[0].id, data });
  if (matches.length > 1) throw new Error(`Medication "${medicineName.trim()}" has multiple configured IDs.`);
  if (assignedId === 0 || assignedId === 1) {
    return validateMedicine({ medicine: medicineName.trim(), id: assignedId, data });
  }
  throw new Error(`Cannot resolve medication "${medicineName.trim()}" to a configured ID.`);
}

const SCHEDULE_READ_UNAVAILABLE = 'The dispenser stores dose packets, but its BLE interface does not expose schedule contents or medicine names.';
const PREVIOUS_STATUS_UNAVAILABLE = 'The app and dispenser do not expose a previous dispense event or confirmation status.';

export function createMedicationClientTools(options: {
  connected: boolean;
  getNextMedicineId?: () => Promise<0 | 1>;
  medications?: readonly MedicationIdentity[];
  sendMedicine: (record: MedicineRecord) => Promise<void>;
  removeMedicineSchedule?: (medicineID: 0 | 1) => Promise<void>;
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
        if (!options.connected) throw new Error('Connect the pill dispenser before saving a schedule.');
        const id = options.getNextMedicineId ? await options.getNextMedicineId() : undefined;
        const record = adaptMedicationSchedule(parameters, options.medications ?? [], new Date(), id);
        await options.sendMedicine(record);
        options.onSaved(record.medicine);
        return { success: true as const, medicineName: record.medicine };
      } catch (error) {
        return failure(error);
      }
    },
    getMedicationData: async () => failure(new Error(SCHEDULE_READ_UNAVAILABLE)),
    getNextMedication: async () => failure(new Error(SCHEDULE_READ_UNAVAILABLE)),
    getPrevMedicationStatus: async () => failure(new Error(PREVIOUS_STATUS_UNAVAILABLE)),
    removeMedicineSchedule: async (parameters: unknown) => {
      try {
        const medicineID = parameters && typeof parameters === 'object'
          ? (parameters as Record<string, unknown>).medicineID
          : undefined;
        if (medicineID !== 0 && medicineID !== 1) throw new Error('medicineID must be exactly 0 or 1.');
        if (!options.removeMedicineSchedule) throw new Error('Removing medicine schedules is not available in this app build.');
        await options.removeMedicineSchedule(medicineID);
        return {
          success: true as const,
          medicineId: medicineID,
          message: 'Medication schedule removed successfully.',
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

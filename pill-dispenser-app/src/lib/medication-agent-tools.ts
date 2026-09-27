import { type MedicineRecord, validateMedicine } from './medicine';
import { type ServerMedicationSchedule } from './medicine-api';

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

const PREVIOUS_STATUS_UNAVAILABLE = 'The app and dispenser do not expose a previous dispense event or confirmation status.';

function normalizeMedicationName(value: string) {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.replace(/^vitamin([a-z])$/, 'vit$1');
}

function editDistance(left: string, right: string) {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[right.length];
}

export function findNextMedication(
  medicineQuery: unknown,
  schedules: readonly ServerMedicationSchedule[],
  now = new Date(),
) {
  if (typeof medicineQuery !== 'string' || !medicineQuery.trim()) {
    throw new Error('medicineQuery must contain the medication name from the user.');
  }
  const query = normalizeMedicationName(medicineQuery);
  const named = schedules.map(item => ({ item, name: normalizeMedicationName(item.medicine) }));
  const exact = named.filter(item => item.name === query);
  let matches = exact;
  if (matches.length === 0 && query.length >= 7) {
    const close = named.map(candidate => ({ ...candidate, distance: editDistance(query, candidate.name) }))
      .filter(candidate => candidate.distance <= Math.max(1, Math.floor(Math.min(query.length, candidate.name.length) * 0.15)))
      .sort((left, right) => left.distance - right.distance);
    if (close.length > 1 && close[0].distance === close[1].distance) {
      throw new Error(`"${medicineQuery.trim()}" could refer to more than one medication. Please clarify the name.`);
    }
    matches = close.slice(0, 1);
  }
  if (matches.length === 0) {
    throw new Error(`I couldn't match "${medicineQuery.trim()}" to a saved medication. Please use its saved name.`);
  }
  if (matches.length > 1) throw new Error(`"${medicineQuery.trim()}" matches multiple saved medications. Please clarify.`);

  const { item } = matches[0];
  if (!item.data?.length) {
    throw new Error(`${item.medicine} has no readable dose schedule on the server. Sync its schedule from the app first.`);
  }
  const candidates = item.data.map(entry => {
    const match = /^(\d{2}):(\d{2}) UTC$/.exec(entry.time);
    if (!match || !Number.isInteger(entry.dose) || entry.dose <= 0) {
      throw new Error(`The saved schedule for ${item.medicine} is invalid.`);
    }
    const next = new Date(now);
    next.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return { next, quantity: entry.dose };
  }).sort((left, right) => left.next.getTime() - right.next.getTime());
  const nearest = candidates[0];
  return {
    success: true as const,
    medicineName: item.medicine,
    quantity: nearest.quantity,
    time: `${String(nearest.next.getHours()).padStart(2, '0')}:${String(nearest.next.getMinutes()).padStart(2, '0')}`,
  };
}

export function createMedicationClientTools(options: {
  connected: boolean;
  getMedicineIdForName: (medicineName: string) => Promise<0 | 1>;
  getMedicationNames: () => Promise<Array<{ id: 0 | 1; medicineName: string }>>;
  saveMedicineName: (medicineID: 0 | 1, medicineName: string) => Promise<void>;
  medications?: readonly MedicationIdentity[];
  getServerSchedules: () => Promise<readonly ServerMedicationSchedule[]>;
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
        const draft = adaptMedicationSchedule(parameters, options.medications ?? [], new Date(), 0);
        const id = await options.getMedicineIdForName(draft.medicine);
        const record = validateMedicine({ ...draft, id });
        await options.sendMedicine(record);
        await options.saveMedicineName(record.id, record.medicine);
        options.onSaved(record.medicine);
        return { success: true as const, medicineName: record.medicine };
      } catch (error) {
        return failure(error);
      }
    },
    getMedicationSchedule: async () => {
      try {
        return {
          success: true as const,
          medications: await options.getMedicationNames(),
          scheduleDetailsAvailable: false as const,
        };
      } catch (error) {
        return failure(error);
      }
    },
    getNextMedication: async (parameters: unknown) => {
      try {
        const medicineQuery = parameters && typeof parameters === 'object'
          ? (parameters as Record<string, unknown>).medicineQuery
          : undefined;
        const schedules = await options.getServerSchedules();
        return findNextMedication(medicineQuery, schedules);
      } catch (error) {
        return failure(error);
      }
    },
    getPrevMedicationStatus: async () => failure(new Error(PREVIOUS_STATUS_UNAVAILABLE)),
    removeMedicineSchedule: async (parameters: unknown) => {
      try {
        const input = parameters && typeof parameters === 'object'
          ? (parameters as Record<string, unknown>).medicineID
          : undefined;
        const medicineName = parameters && typeof parameters === 'object'
          ? (parameters as Record<string, unknown>).medicineName
          : undefined;
        const medicineID = input === undefined && typeof medicineName === 'string'
          ? await options.getMedicineIdForName(medicineName)
          : input;
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

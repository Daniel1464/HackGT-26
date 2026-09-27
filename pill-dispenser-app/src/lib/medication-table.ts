/**
 * Builds the medication table shown on the sighted view of the app.
 *
 * The table merges the two places a medicine can live: the schedule stored on
 * the dispenser (read over Bluetooth) and the server registry the app writes
 * to when a schedule is saved. Kept free of React Native imports so the merge
 * stays testable with plain Node.
 */

/** A medicine the dispenser holds, as reported by `getMedicationNames`. */
export type DispenserSlot = { id: number; medicineName: string };

export type DoseEntry = { time: string; dose: number };

/** A medicine the server registry knows about. */
export type RegisteredMedicine = {
  slot: number;
  name: string;
  doses: DoseEntry[];
  /** `time_to_take` from the registry, used when no dose list was stored. */
  fallbackTime: string | null;
};

export type MedicationRow = {
  /** Dispenser slot, 0 or 1. */
  slot: number;
  /** Human readable slot, e.g. `Slot 1`. */
  label: string;
  /** Name to show, preferring what the dispenser actually holds. */
  name: string;
  /** Registered doses, or `0` when nothing is known. */
  doseCount: number;
  /** Earliest registered dose time, or `null`. */
  nextDose: string | null;
  /** Set when the two sources disagree or only one of them knows the slot. */
  note: string;
};

const DOSE_TIME = /^([01]\d|2[0-3]):[0-5]\d UTC$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reads one registry payload entry, returning `null` when it is unusable. */
export function normalizeRegisteredMedicine(value: unknown): RegisteredMedicine | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const slot = record.id;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if ((slot !== 0 && slot !== 1) || !name) return null;

  const doses: DoseEntry[] = [];
  if (Array.isArray(record.data)) {
    for (const entry of record.data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { time, dose } = entry as Record<string, unknown>;
      if (typeof time === 'string' && DOSE_TIME.test(time) &&
          typeof dose === 'number' && Number.isInteger(dose) && dose > 0) {
        doses.push({ time, dose });
      }
    }
  }

  const fallbackTime = typeof record.time_to_take === 'string' && TIME_OF_DAY.test(record.time_to_take)
    ? record.time_to_take
    : null;

  return { slot, name, doses, fallbackTime };
}

/** Reads the `{ medicines: [...] }` envelope of `GET /medicines`, dropping unusable slots. */
export function parseRegisteredMedicines(payload: unknown): RegisteredMedicine[] {
  const medicines = typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>).medicines
    : undefined;
  if (!Array.isArray(medicines)) {
    throw new Error('Server response did not include a medicines list.');
  }
  const parsed: RegisteredMedicine[] = [];
  for (const value of medicines) {
    const medicine = normalizeRegisteredMedicine(value);
    if (medicine) parsed.push(medicine);
  }
  return parsed;
}

/** Merges both sources into one row per occupied slot, ordered by slot. */
export function buildMedicationRows(
  dispenser: readonly DispenserSlot[],
  registry: readonly RegisteredMedicine[],
): MedicationRow[] {
  const dispenserNames = new Map<number, string>();
  for (const entry of dispenser) {
    const name = typeof entry?.medicineName === 'string' ? entry.medicineName.trim() : '';
    if ((entry?.id === 0 || entry?.id === 1) && name && !dispenserNames.has(entry.id)) {
      dispenserNames.set(entry.id, name);
    }
  }

  const registered = new Map<number, RegisteredMedicine>();
  for (const medicine of registry) {
    if (!registered.has(medicine.slot)) registered.set(medicine.slot, medicine);
  }

  const slots = [...new Set([...dispenserNames.keys(), ...registered.keys()])].sort((a, b) => a - b);

  return slots.map((slot) => {
    const dispenserName = dispenserNames.get(slot) ?? null;
    const medicine = registered.get(slot) ?? null;
    const doses = medicine?.doses ?? [];
    const nextDose = doses.length > 0
      ? [...doses].sort((a, b) => a.time.localeCompare(b.time))[0].time
      : medicine?.fallbackTime ?? null;

    let note = '';
    if (dispenserName && medicine) {
      if (dispenserName.toLowerCase() !== medicine.name.toLowerCase()) {
        note = `Server registry lists "${medicine.name}".`;
      }
    } else if (dispenserName) {
      note = 'Not in the server registry.';
    } else {
      note = 'Not on the dispenser.';
    }

    return {
      slot,
      label: `Slot ${slot + 1}`,
      name: dispenserName ?? medicine?.name ?? '',
      doseCount: doses.length > 0 ? doses.length : nextDose ? 1 : 0,
      nextDose,
      note,
    };
  });
}

/** `—` for an unknown count, so empty cells stay legible in the table. */
export function describeDoseCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '—';
  return count === 1 ? '1 dose' : `${count} doses`;
}

/** One sentence per row, read out by screen readers. */
export function describeMedicationRow(row: MedicationRow): string {
  const next = row.nextDose ? `next dose ${row.nextDose}` : 'no dose scheduled';
  return `${row.label}: ${row.name}, ${describeDoseCount(row.doseCount)}, ${next}.` +
    (row.note ? ` ${row.note}` : '');
}

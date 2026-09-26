export type MedicineRecord = {
  medicine: string;
  id: 0 | 1;
  data: { time: string; dose: number }[];
};

export function validateMedicine(value: unknown): MedicineRecord {
  const record = value as MedicineRecord | null;
  if (!record || typeof record.medicine !== 'string' || !record.medicine.trim() ||
      (record.id !== 0 && record.id !== 1) || !Array.isArray(record.data) ||
      record.data.length < 1 || record.data.length > 32) {
    throw new Error('Provide a medicine name, ID 0 or 1, and 1–32 doses.');
  }
  for (const entry of record.data) {
    if (!entry || typeof entry.time !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d UTC$/.test(entry.time) ||
        !Number.isInteger(entry.dose) || entry.dose < 1 || entry.dose > 2147483647) {
      throw new Error('Each dose needs a time like 08:00 UTC and a positive integer dose.');
    }
  }
  return { medicine: record.medicine.trim(), id: record.id,
    data: record.data.map(({ time, dose }) => ({ time, dose })) };
}

/** Guided grammar deliberately rejects unrecognized text instead of guessing. */
export function parseMedicineTranscript(transcript: string): MedicineRecord {
  const words: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3',
    four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12' };
  const text = transcript.trim().replace(/[.,;!?]/g, '').replace(/\bU\s*T\s*C\b/gi, 'UTC');
  const header = /^medicine\s+(.+?)\s+id\s+(zero|one|0|1)\s+(.+)$/i.exec(text);
  if (!header) throw new Error('Say: Medicine Vitamin A, ID zero, at eight AM UTC dose two.');
  const data = header[3].split(/\s+and\s+/i).map((part) => {
    const normalized = part.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
      (word) => words[word.toLowerCase()]);
    const match = /^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+UTC\s+dose\s+(\d+)$/i.exec(normalized);
    if (!match) throw new Error('Use one or more entries like: at 08:00 UTC dose 2, joined with “and”.');
    let hour = Number(match[1]);
    if (match[3]) {
      if (hour < 1 || hour > 12) throw new Error('AM/PM hours must be 1–12.');
      hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    }
    return { time: `${String(hour).padStart(2, '0')}:${match[2] ?? '00'} UTC`, dose: Number(match[4]) };
  });
  return validateMedicine({ medicine: header[1], id: Number(words[header[2].toLowerCase()] ?? header[2]), data });
}

/** Fixed binary packet: medicine ID (u8), UTC minutes (u16 LE), dose (u32 LE). */
export function medicineDosePacket(record: MedicineRecord, entry: { time: string; dose: number }): ArrayBuffer {
  const validated = validateMedicine(record);
  const match = /^(\d{2}):(\d{2}) UTC$/.exec(entry.time);
  if (!match || !validated.data.some((candidate) => candidate.time === entry.time && candidate.dose === entry.dose)) {
    throw new Error('Dose time must use HH:MM UTC and belong to the medicine record.');
  }
  const packet = new ArrayBuffer(7);
  const view = new DataView(packet);
  view.setUint8(0, validated.id);
  view.setUint16(1, Number(match[1]) * 60 + Number(match[2]), true);
  view.setUint32(3, entry.dose, true);
  return packet;
}

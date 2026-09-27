import { validateMedicine, type MedicineRecord } from './medicine';

export type ServerMedicationSchedule = {
  id: 0 | 1;
  medicine: string;
  data?: Array<{ time: string; dose: number }>;
};

export async function getServerMedicationSchedules(): Promise<ServerMedicationSchedule[]> {
  const base = process.env.EXPO_PUBLIC_SERVER_API_URL?.trim().replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SERVER_API_KEY?.trim();
  if (!base || !key) throw new Error('Set the server API URL and API key to read medication schedules.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/medicines`, {
      headers: { 'X-API-Key': key }, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status} while reading schedules.`);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !Array.isArray((result as { medicines?: unknown }).medicines)) {
      throw new Error('Server returned an invalid medication schedule response.');
    }
    return (result as { medicines: unknown[] }).medicines.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Server returned an invalid medication record.');
      const value = item as Record<string, unknown>;
      if ((value.id !== 0 && value.id !== 1) || typeof value.name !== 'string' || !value.name.trim()) {
        throw new Error('Server returned an invalid medication identity.');
      }
      if (value.data === undefined) return { id: value.id, medicine: value.name };
      if (!Array.isArray(value.data) || value.data.some(entry => !entry || typeof entry !== 'object' ||
          typeof (entry as Record<string, unknown>).time !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d UTC$/.test((entry as Record<string, string>).time) ||
          !Number.isInteger((entry as Record<string, unknown>).dose) ||
          ((entry as Record<string, unknown>).dose as number) <= 0)) {
        throw new Error(`Server returned an invalid dose schedule for ${value.name}.`);
      }
      return { id: value.id, medicine: value.name, data: value.data as Array<{ time: string; dose: number }> };
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Schedule lookup timed out after 8 seconds.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Prepare before BLE writes so missing configuration cannot cause a partial save.
export function prepareMedicineSync(input: MedicineRecord): () => Promise<void> {
  const record = validateMedicine(input);
  const base = process.env.EXPO_PUBLIC_SERVER_API_URL?.trim().replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SERVER_API_KEY?.trim();
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error('Set EXPO_PUBLIC_SERVER_API_URL to your server HTTP(S) URL.');
  }
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Server API URL must not contain credentials, a query, or a fragment.');
  }
  if (!key) throw new Error('Set EXPO_PUBLIC_SERVER_API_KEY to match the server API_KEY.');
  const body = JSON.stringify(record);
  return async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base}/medicines/${record.id}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Server sync timed out after 8 seconds.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function broadcastAndSyncMedicine(
  record: MedicineRecord,
  broadcast: (record: MedicineRecord) => Promise<void>,
) {
  const validated = validateMedicine(record);
  const sync = prepareMedicineSync(validated);
  await broadcast(validated);
  try {
    await sync();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Network request failed.';
    throw new Error(`Medicine was sent to the dispenser, but server sync was not confirmed. ${detail} Do not automatically resend the BLE schedule.`);
  }
}

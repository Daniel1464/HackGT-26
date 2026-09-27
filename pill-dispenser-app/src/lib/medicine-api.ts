import { validateMedicine, type MedicineRecord } from './medicine';

// Prepare before BLE writes so missing configuration cannot cause a partial save.
export function prepareMedicineSync(input: MedicineRecord): () => Promise<void> {
  const record = validateMedicine(input);
  const base = process.env.EXPO_PUBLIC_SERVER_API_URL?.trim().replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error('Set EXPO_PUBLIC_SERVER_API_URL to your server HTTP(S) URL.');
  }
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Server API URL must not contain credentials, a query, or a fragment.');
  }
  const body = JSON.stringify(record);
  return async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base}/medicines/${record.id}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

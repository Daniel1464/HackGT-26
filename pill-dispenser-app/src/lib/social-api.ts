export type SocialProvider = 'x' | 'instagram';
export type SocialAccount = { provider: SocialProvider; account_id: string; username: string; assigned: boolean };

export async function socialRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const base = process.env.EXPO_PUBLIC_SERVER_API_URL?.trim().replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SERVER_API_KEY?.trim();
  if (!base || !key) throw new Error('Configure EXPO_PUBLIC_SERVER_API_URL and EXPO_PUBLIC_SERVER_API_KEY first.');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid server API URL.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}${path}`, {
      method, headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(typeof details?.detail === 'string' ? details.detail : `Server returned HTTP ${response.status}.`);
    }
    return response.status === 204 ? undefined as T : await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Server request timed out. Try refreshing.');
    throw error;
  } finally { clearTimeout(timer); }
}

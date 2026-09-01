import { setTimeout as sleep } from 'node:timers/promises';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string,
  ) {
    super(`HTTP ${status} sur ${url}: ${body.slice(0, 400)}`);
  }
}

export interface FetchJsonOptions extends RequestInit {
  retries?: number;
  timeoutMs?: number;
}

/** fetch avec timeout + retries exponentiels sur erreurs réseau et 429/5xx. */
export async function fetchWithRetry(url: string, opts: FetchJsonOptions = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 30_000, ...init } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await res.body?.cancel();
        await sleep(2 ** attempt * 1000);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(2 ** attempt * 1000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return (text ? JSON.parse(text) : {}) as T;
}

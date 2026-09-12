import { setTimeout as sleep } from 'node:timers/promises';
import dns from 'node:dns/promises';
import net from 'node:net';

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

/** Adresse IP privée, locale ou de métadonnées cloud (jamais ouverte depuis le serveur). */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80')) return true;
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
  }
  return false;
}

/**
 * Une URL est-elle publique (http/https, hôte ni local ni privé) ? Contrôle
 * syntaxique seul — pour les URL proposées par un LLM ou saisies à la main.
 */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host) && isPrivateAddress(host)) return false;
  return true;
}

/**
 * Raison pour laquelle une URL ne doit pas être ouverte depuis le serveur
 * (protocole, hôte local, résolution DNS vers une adresse privée) — null si elle est sûre.
 */
export async function publicUrlProblem(raw: string): Promise<string | null> {
  if (!isPublicHttpUrl(raw)) return 'URL non publique (protocole ou hôte local / privé)';
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return null;
  try {
    const addresses = await dns.lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return 'hôte inconnu';
    if (addresses.some((a) => isPrivateAddress(a.address))) return 'URL non publique (résout vers une adresse privée)';
    return null;
  } catch {
    return 'hôte introuvable';
  }
}

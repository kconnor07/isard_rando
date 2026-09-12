export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Détail d'erreur renvoyé par le serveur → phrase lisible (les erreurs de validation zod deviennent « champ : message »). */
export function describeErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const issues = detail as { path?: (string | number)[]; message?: string }[];
    const parts = issues.slice(0, 4).map((i) => `${(i.path ?? []).join('.') || 'champ'} : ${i.message ?? 'invalide'}`);
    return parts.length ? `Données invalides — ${parts.join(' · ')}` : fallback;
  }
  return fallback;
}

/** Message d'erreur à montrer à l'utilisateur, quel que soit l'objet reçu. */
export function humanizeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError && /fetch/i.test(err.message)) return 'Serveur injoignable — vérifiez la connexion ou réessayez dans un instant.';
  if (err instanceof Error) return err.message.replace(/^(ApiError|Error):\s*/, '');
  return String(err);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable — vérifiez la connexion ou réessayez dans un instant.');
  }
  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Non authentifié');
  }
  const text = await res.text();
  let data: T & { error?: unknown };
  try {
    data = text ? (JSON.parse(text) as T & { error?: unknown }) : ({} as T & { error?: unknown });
  } catch {
    // Page HTML d'un proxy (502 pendant un déploiement…) : jamais de JSON.parse en erreur brute
    throw new ApiError(res.status, res.ok ? 'Réponse serveur invalide' : `Serveur indisponible (HTTP ${res.status}) — réessayez dans un instant.`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, describeErrorDetail(data.error, `Erreur HTTP ${res.status}`));
  }
  return data;
}

/** Téléversement multipart : même lecture d'erreur que les appels JSON. */
export async function upload<T = { id: string }>(url: string, file: File, field = 'file', extra: Record<string, string> = {}): Promise<T> {
  const body = new FormData();
  body.append(field, file);
  for (const [k, v] of Object.entries(extra)) body.append(k, v);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Serveur injoignable — le fichier n’a pas pu être envoyé.');
  }
  const text = await res.text();
  let data: T & { error?: unknown };
  try {
    data = text ? (JSON.parse(text) as T & { error?: unknown }) : ({} as T & { error?: unknown });
  } catch {
    throw new ApiError(res.status, `Téléversement refusé (HTTP ${res.status})`);
  }
  if (!res.ok) throw new ApiError(res.status, describeErrorDetail(data.error, res.status === 413 ? 'Fichier trop volumineux' : `Téléversement refusé (HTTP ${res.status})`));
  return data;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

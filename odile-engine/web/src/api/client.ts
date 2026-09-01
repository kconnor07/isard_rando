export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new ApiError(401, 'Non authentifié');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { error?: unknown }) : ({} as T);
  if (!res.ok) {
    const detail = (data as { error?: unknown }).error;
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail ?? res.statusText));
  }
  return data;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
};

/** Standard API error shape: { error: { code, message, details? } } (CLAUDE.md conventions). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError("unreachable", `cannot reach ${base}`, 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error pages fall through to the generic message below */
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(e?.code ?? "http_error", e?.message ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export const post = <T>(base: string, path: string, data: unknown) =>
  request<T>(base, path, { method: "POST", body: JSON.stringify(data ?? {}) });

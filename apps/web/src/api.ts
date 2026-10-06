/** Fetch helpers. State-changing calls carry the per-run token the server injects into the page. */
const token = () =>
  document.querySelector<HTMLMetaElement>('meta[name="landed-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(path: string) => fetch(path).then((r) => handle<T>(r));

export const send = <T>(method: "POST" | "PUT", path: string, body?: unknown) =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-landed-token": token() },
    body: JSON.stringify(body ?? {}),
  }).then((r) => handle<T>(r));

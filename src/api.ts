export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-Fieldboard-Request", "1");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export const send = (
  path: string,
  data: unknown,
  method = "POST",
  key?: string,
) =>
  api(path, {
    method,
    body: JSON.stringify(data),
    headers: key ? { "Idempotency-Key": key } : {},
  });
export const moneyless = (v: number | null | undefined, unit = "") =>
  v === null || v === undefined
    ? "No data"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v)}${unit === "%" ? "%" : unit ? " " + unit : ""}`;
export const fmtDate = (v: string | undefined) =>
  !v
    ? "Unconfirmed"
    : new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", year: "numeric" },
      );

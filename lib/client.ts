export async function api(path: string, payload?: unknown): Promise<any> {
  const response = await fetch("/api/" + path, {
    method: payload === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      payload === undefined ? {} : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
export const act = (action: string, payload: unknown = {}) =>
  api("action", { action, payload });
export function dateLabel(value?: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Date not provided";
}

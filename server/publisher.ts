import type { NtfySettingsValues } from "../shared/ntfy";

export interface NtfyNotification {
  title: string;
  message: string;
  click?: string;
}

export type NtfyFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

export async function publishNtfy(
  settings: NtfySettingsValues,
  notification: NtfyNotification,
  options: {
    fetch?: NtfyFetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (!settings.topic) {
    throw new Error("Ntfy topic is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.accessToken) {
    headers.Authorization = `Bearer ${settings.accessToken}`;
  }
  const body = {
    topic: settings.topic,
    title: notification.title,
    message: notification.message,
    priority: settings.priority,
    ...(notification.click ? { click: notification.click } : {}),
  };
  const fetchNtfy = options.fetch ?? (fetch as unknown as NtfyFetch);
  try {
    const response = await fetchNtfy(settings.serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ntfy returned HTTP ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function paseoAgentDeepLink(serverId: string, agentId: string): string {
  return `paseo://h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
}

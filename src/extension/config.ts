// Shared settings + message contract for the octobase capture extension.

export interface Settings {
  port: number;
  token: string;
}

export const DEFAULTS: Settings = { port: 7373, token: "" };

export function baseUrl(s: Settings): string {
  return `http://127.0.0.1:${s.port}`;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(["port", "token"]);
  return {
    port: typeof stored.port === "number" ? stored.port : DEFAULTS.port,
    token: typeof stored.token === "string" ? stored.token : DEFAULTS.token,
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

// Messages content/popup → background.
export type BgMessage =
  | { type: "send"; path: "/capture" | "/highlight"; body: unknown }
  | { type: "health" }
  | { type: "queueSize" };

// Messages popup → content script.
export type TabMessage = { type: "capture" };

export interface SendResult {
  ok: boolean;
  status?: number;
  queued?: boolean;
  error?: string;
  id?: string | null;
}

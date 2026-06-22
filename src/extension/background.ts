// Service worker: the only place that talks to the localhost app. Content
// scripts and the popup message it; it adds the auth token, posts, and queues
// failed sends to retry when the app comes back.

import {
  baseUrl,
  getSettings,
  type BgMessage,
  type SendResult,
} from "./config.ts";

const QUEUE_KEY = "queue";

interface QueuedItem {
  path: "/capture" | "/highlight";
  body: unknown;
  at: number;
}

async function getQueue(): Promise<QueuedItem[]> {
  const s = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(s[QUEUE_KEY]) ? (s[QUEUE_KEY] as QueuedItem[]) : [];
}
async function setQueue(q: QueuedItem[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: q });
}

async function post(path: string, body: unknown): Promise<SendResult> {
  const settings = await getSettings();
  const res = await fetch(`${baseUrl(settings)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Octobase-Token": settings.token },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string | null; error?: string };
  if (!res.ok) return { ok: false, status: res.status, error: json.error };
  return { ok: true, status: res.status, id: json.id ?? null };
}

async function send(path: "/capture" | "/highlight", body: unknown): Promise<SendResult> {
  try {
    const result = await post(path, body);
    if (!result.ok && result.status !== 401 && result.status !== 400) {
      await enqueue(path, body);
      return { ...result, queued: true };
    }
    return result;
  } catch {
    // App offline → queue for later.
    await enqueue(path, body);
    return { ok: false, queued: true, error: "app offline; queued" };
  }
}

async function enqueue(path: "/capture" | "/highlight", body: unknown): Promise<void> {
  const q = await getQueue();
  q.push({ path, body, at: Date.now() });
  await setQueue(q);
  updateBadge(q.length);
}

async function flushQueue(): Promise<void> {
  const q = await getQueue();
  if (q.length === 0) return;
  const remaining: QueuedItem[] = [];
  for (const item of q) {
    try {
      const r = await post(item.path, item.body);
      if (!r.ok && r.status !== 400) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);
  updateBadge(remaining.length);
}

function updateBadge(count: number): void {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#b8893b" });
}

chrome.runtime.onMessage.addListener((msg: BgMessage, _sender, reply) => {
  (async () => {
    if (msg.type === "send") {
      reply(await send(msg.path, msg.body));
    } else if (msg.type === "health") {
      try {
        const settings = await getSettings();
        const res = await fetch(`${baseUrl(settings)}/health`);
        reply({ ok: res.ok });
        if (res.ok) void flushQueue();
      } catch {
        reply({ ok: false });
      }
    } else if (msg.type === "queueSize") {
      reply({ size: (await getQueue()).length });
    }
  })();
  return true; // async reply
});

// Context-menu entries mirror the popup actions.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "octo-capture", title: "octobase: Capture article", contexts: ["page"] });
  chrome.contextMenus.create({ id: "octo-highlight", title: "octobase: Highlight selection", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "octo-capture") chrome.tabs.sendMessage(tab.id, { type: "capture" });
  if (info.menuItemId === "octo-highlight") chrome.tabs.sendMessage(tab.id, { type: "highlight-selection" });
});

// Periodically retry the queue.
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "flush") void flushQueue(); });

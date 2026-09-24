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
// Queue flushes and sends must not overwrite each other's storage snapshots.
let operations: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => {});
  return result;
}

type SendPath = "/capture" | "/highlight" | "/highlight/delete";

interface QueuedItem {
  path: SendPath;
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

async function send(path: SendPath, body: unknown): Promise<SendResult> {
  await flushQueue();
  if ((await getQueue()).length) {
    await enqueue(path, body);
    return { ok: false, queued: true, error: "waiting for earlier changes to sync" };
  }
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

async function enqueue(path: SendPath, body: unknown): Promise<void> {
  const q = await getQueue();
  q.push({ path, body, at: Date.now() });
  await setQueue(q);
  updateBadge(q.length);
}

async function flushQueue(): Promise<void> {
  const q = await getQueue();
  if (q.length === 0) return;
  let remaining: QueuedItem[] = [];
  for (let i = 0; i < q.length; i++) {
    try {
      const r = await post(q[i].path, q[i].body);
      if (r.ok || r.status === 400) continue;
    } catch {
      // Stop at the first failure: a later delete must never pass an older upsert.
    }
    remaining = q.slice(i);
    break;
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
      reply(await serialize(() => send(msg.path, msg.body)));
    } else if (msg.type === "health") {
      try {
        const settings = await getSettings();
        const res = await fetch(`${baseUrl(settings)}/health`, {
          headers: settings.token ? { "X-Octobase-Token": settings.token } : {},
        });
        const body = res.ok ? await res.json().catch(() => ({})) : {};
        // Reachable is not paired: with a wrong token every send would 401.
        const paired = res.ok && body.paired === true;
        reply({ ok: res.ok, paired });
        if (paired) void serialize(flushQueue);
      } catch {
        reply({ ok: false });
      }
    } else if (msg.type === "queueSize") {
      reply({ size: (await getQueue()).length });
    } else if (msg.type === "listHighlights") {
      try {
        // Never let reverse sync resurrect a queued delete or erase an offline note.
        const pending = await serialize(async () => {
          await flushQueue();
          return (await getQueue()).length > 0;
        });
        if (pending) { reply({ ok: false, highlights: [] }); return; }
        const settings = await getSettings();
        const res = await fetch(
          `${baseUrl(settings)}/highlights?url=${encodeURIComponent(msg.url)}`,
          { headers: { "X-Octobase-Token": settings.token } },
        );
        const json = (await res.json().catch(() => ({}))) as { highlights?: unknown };
        reply({ ok: res.ok, highlights: Array.isArray(json.highlights) ? json.highlights : [] });
      } catch {
        reply({ ok: false, highlights: [] });
      }
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
  const tabId = tab?.id;
  if (!tabId) return;
  const type = info.menuItemId === "octo-capture" ? "capture" : "highlight-selection";
  void (async () => {
    // Make sure the content script is present (the tab may predate install).
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      return; // restricted page
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type });
    } catch {
      /* page not reachable */
    }
  })();
});

// Periodically retry the queue.
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "flush") void serialize(flushQueue); });

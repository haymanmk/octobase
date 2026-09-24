import assert from "node:assert/strict";
import test from "node:test";

test("offline changes stay ordered and block reverse sync until flushed", async () => {
  const previousFetch = globalThis.fetch;
  const env = globalThis as unknown as { chrome?: unknown };
  const previousChrome = env.chrome;
  const storage: Record<string, unknown> = { queue: [{ path: "/highlight", body: { id: "a", note: "old" }, at: 1 }] };
  let listener: (msg: unknown, sender: unknown, reply: (value: unknown) => void) => void;
  const event = { addListener: () => {} };
  env.chrome = {
    storage: { local: {
      get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map((k) => [k, structuredClone(storage[k])])),
      set: async (patch: Record<string, unknown>) => { Object.assign(storage, structuredClone(patch)); },
    } },
    runtime: { onMessage: { addListener: (cb: typeof listener) => { listener = cb; } }, onInstalled: event },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    contextMenus: { onClicked: event },
    alarms: { create: () => {}, onAlarm: event },
  };
  let online = false;
  const posts: string[] = [];
  globalThis.fetch = async (_url, options) => {
    if (!online) throw new Error("offline");
    if (options?.method === "POST") posts.push(String(options.body));
    return new Response(JSON.stringify({ ok: true, highlights: [] }), { status: 200 });
  };
  try {
    await import("../src/extension/background.ts");
    const request = (msg: unknown) => new Promise<unknown>((resolve) => listener(msg, {}, resolve));
    const result = await request({ type: "send", path: "/highlight/delete", body: { id: "a" } });
    assert.equal((result as { queued: boolean }).queued, true);
    assert.equal((storage.queue as unknown[]).length, 2);
    assert.equal((await request({ type: "listHighlights", url: "https://example.com" }) as { ok: boolean }).ok, false);
    online = true;
    assert.equal((await request({ type: "listHighlights", url: "https://example.com" }) as { ok: boolean }).ok, true);
    assert.deepEqual(posts.map((body) => JSON.parse(body)), [{ id: "a", note: "old" }, { id: "a" }]);
    assert.deepEqual(storage.queue, []);
  } finally {
    globalThis.fetch = previousFetch;
    env.chrome = previousChrome;
  }
});

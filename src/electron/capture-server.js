import http from "node:http";
import { randomUUID } from "node:crypto";

const MAX_BODY = 8 * 1024 * 1024; // 8 MB — full captured articles can be large.

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * A loopback HTTP server the Chrome extension posts captures and highlights to.
 * Transport choice for octobase: local-first, no accounts, same machine.
 *
 * Pure Node (no Electron), so it can be unit-tested with real HTTP requests.
 * The caller wires `onCapture` / `onHighlight` to the workspace (e.g. forward to
 * the renderer over IPC).
 */
export function createCaptureServer(options = {}) {
  const {
    port = 7373,
    host = "127.0.0.1",
    token = randomUUID(),
    onCapture,
    onHighlight,
    onHighlightDelete,
    onListHighlights,
  } = options;

  let server = null;

  function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Octobase-Token",
    );
  }

  function send(res, status, body) {
    cors(res);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  async function handler(req, res) {
    if (req.method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${host}`);

    // Unauthenticated health/handshake so the extension can detect the app.
    if (url.pathname === "/health" && req.method === "GET") {
      send(res, 200, { ok: true, app: "octobase", version: 1 });
      return;
    }

    if (req.headers["x-octobase-token"] !== token) {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    if (url.pathname === "/capture" && req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.url !== "string" || typeof body.markdown !== "string") {
        send(res, 400, { error: "invalid capture: url and markdown required" });
        return;
      }
      const result = (await onCapture?.(body)) ?? null;
      send(res, 200, { ok: true, id: result?.id ?? null });
      return;
    }

    if (url.pathname === "/highlight" && req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.url !== "string" || !body.anchor || typeof body.anchor.exact !== "string") {
        send(res, 400, { error: "invalid highlight: url and anchor.exact required" });
        return;
      }
      const result = (await onHighlight?.(body)) ?? null;
      send(res, 200, { ok: true, id: result?.id ?? null });
      return;
    }

    if (url.pathname === "/highlight/delete" && req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.id !== "string") {
        send(res, 400, { error: "invalid: id required" });
        return;
      }
      await onHighlightDelete?.(body.id);
      send(res, 200, { ok: true });
      return;
    }

    // Reverse sync: the extension fetches the app's current highlights for a URL
    // on page load, so edits/deletes made in the app show up on the page.
    if (url.pathname === "/highlights" && req.method === "GET") {
      const forUrl = url.searchParams.get("url") ?? "";
      const items = (await onListHighlights?.(forUrl)) ?? [];
      send(res, 200, { ok: true, highlights: items });
      return;
    }

    send(res, 404, { error: "not found" });
  }

  return {
    token,
    get port() {
      const addr = server && server.address();
      return addr && typeof addr === "object" ? addr.port : port;
    },
    start() {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          handler(req, res).catch(() => {
            try { send(res, 500, { error: "internal" }); } catch { /* ignore */ }
          });
        });
        server.on("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server = null;
      });
    },
  };
}

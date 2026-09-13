import * as React from "react";
import { BrandMark } from "./BrandMark.tsx";
import { WorkspaceStore } from "../lib/store/workspace-store.ts";
import { LocalStoragePersistence } from "../lib/store/persistence.ts";
import { SplashContext, StoreContext } from "./store-context.ts";
import { getCaptureBridge } from "./electron-bridge.ts";

/** How long the splash stays up even when the store loads instantly (ms). */
const SPLASH_HOLD_MS = 3000;
/** Shortened hold when the OS asks for reduced motion (ms). */
const SPLASH_HOLD_REDUCED_MS = 300;
/** Fade-out duration — keep in sync with the ws-boot-leave CSS transition. */
const SPLASH_FADE_MS = 500;

export function WorkspaceProvider({
  children,
  store: providedStore,
}: {
  children: React.ReactNode;
  store?: WorkspaceStore;
}) {
  const [store] = React.useState<WorkspaceStore>(
    () => providedStore ?? new WorkspaceStore(new LocalStoragePersistence()),
  );
  const [ready, setReady] = React.useState<boolean>(() => store.isLoaded());
  // Splash lifecycle: hold the welcome screen for a beat even when the store
  // loads instantly, then fade it out over the already-rendered workspace.
  const [splash, setSplash] = React.useState<"hold" | "leave" | "done">("hold");
  const [splashHeld, setSplashHeld] = React.useState(false);

  React.useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(
      () => setSplashHeld(true),
      reduceMotion ? SPLASH_HOLD_REDUCED_MS : SPLASH_HOLD_MS,
    );
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!ready || !splashHeld) return;
    setSplash((s) => (s === "hold" ? "leave" : s));
  }, [ready, splashHeld]);

  React.useEffect(() => {
    if (splash !== "leave") return;
    const t = setTimeout(() => setSplash("done"), SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [splash]);

  React.useEffect(() => {
    let cancelled = false;
    if (!store.isLoaded()) {
      void store.init().then(() => {
        if (!cancelled) setReady(true);
      });
    } else {
      setReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, [store]);

  // In Electron, captures/highlights from the Chrome extension arrive over IPC
  // and land in the inbox.
  React.useEffect(() => {
    const bridge = getCaptureBridge();
    if (!bridge) return;
    bridge.onCapture((d) => {
      // Re-capturing a page refreshes the existing article instead of
      // creating a duplicate card (and a duplicate reader tab with it).
      const existing = store
        .getCards()
        .find((c) => c.kind === "article" && c.sourceUrl === d.url);
      if (existing) {
        store.updateCard(existing.id, { title: d.title, body: d.markdown });
        return;
      }
      store.createArticleCard({
        title: d.title,
        body: d.markdown,
        sourceUrl: d.url,
        siteName: d.siteName,
        byline: d.byline,
      });
    });
    // Highlights arrive here from both the capture extension and the live
    // browser pane (main.js routes the pane's saves through this channel), so
    // this store is the one place a highlight lives.
    bridge.onHighlight((d) => {
      store.upsertHighlight({
        id: d.id,
        text: d.exact ?? d.anchor.exact,
        sourceUrl: d.url,
        anchor: d.anchor,
        color: d.color,
        note: d.note,
        tags: d.tags,
        domAnchor: d.domAnchor,
      });
    });
    bridge.onHighlightRemove(({ id }) => store.deleteCard(id));
    // Hand a URL's highlights back to whoever asked — the extension on page
    // load, or the browser pane when it re-applies them.
    bridge.onHighlightsRequest(({ reqId, url }) => {
      const items = store.getHighlightsForUrl(url).map((h) => ({
        id: h.id,
        color: h.color,
        anchor: h.anchor,
        exact: h.anchor.exact,
        tags: h.tags,
        note: h.body,
        ...(h.domAnchor ? { domAnchor: h.domAnchor } : {}),
      }));
      bridge.respondHighlights(reqId, items);
    });
    // Highlights saved before the browser pane shared this store still live
    // in the main process's JSON file; adopt them once, by id.
    void bridge.importLegacyHighlights?.().then((items) => {
      if (!items?.length) return;
      for (const d of items) {
        store.upsertHighlight({
          id: d.id,
          text: d.exact ?? d.anchor.exact,
          sourceUrl: d.url,
          anchor: d.anchor,
          color: d.color,
          note: d.note,
          tags: d.tags,
          domAnchor: d.domAnchor,
        });
      }
      bridge.legacyImportDone?.();
    });
  }, [store]);

  return (
    <StoreContext.Provider value={store}>
      <SplashContext.Provider value={splash !== "done"}>
        {ready ? children : null}
      </SplashContext.Provider>
      {splash !== "done" && (
        <div className={splash === "leave" ? "ws-boot ws-boot-leave" : "ws-boot"} aria-hidden={ready}>
          <div className="ws-boot-inner">
            <div className="ws-boot-mark">
              <BrandMark variant="light" size={96} />
            </div>
            <h1 className="ws-boot-word">
              octo<span className="ws-brand-dot">·</span>base
            </h1>
            <span className="ws-boot-tag">
              {ready ? "Welcome back" : "Loading your workspace…"}
            </span>
          </div>
        </div>
      )}
    </StoreContext.Provider>
  );
}

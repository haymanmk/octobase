import * as React from "react";
import { WorkspaceStore } from "../lib/store/workspace-store.ts";
import { LocalStoragePersistence } from "../lib/store/persistence.ts";
import { StoreContext } from "./store-context.ts";
import { getCaptureBridge } from "./electron-bridge.ts";

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
      store.createArticleCard({
        title: d.title,
        body: d.markdown,
        sourceUrl: d.url,
        siteName: d.siteName,
        byline: d.byline,
      });
    });
    bridge.onHighlight((d) => {
      store.createHighlightCard({
        text: d.exact ?? d.anchor.exact,
        sourceUrl: d.url,
        anchor: d.anchor,
        color: d.color,
      });
    });
  }, [store]);

  if (!ready) {
    return <div className="ws-boot">Loading your workspace…</div>;
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

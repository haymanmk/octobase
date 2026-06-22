import * as React from "react";
import { WorkspaceStore } from "../lib/store/workspace-store.ts";
import { LocalStoragePersistence } from "../lib/store/persistence.ts";
import { StoreContext } from "./store-context.ts";

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

  if (!ready) {
    return <div className="ws-boot">Loading your workspace…</div>;
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

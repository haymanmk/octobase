import * as React from "react";
import { WorkspaceStore } from "../lib/store/workspace-store.ts";

export const StoreContext = React.createContext<WorkspaceStore | null>(null);

/**
 * True while the boot splash still covers the workspace. The native browser
 * view paints above the DOM, so anything docking it must stay suspended
 * until the splash is gone.
 */
export const SplashContext = React.createContext(false);

/** Access the store and subscribe to its version so the component re-renders on change. */
export function useWorkspace(): WorkspaceStore {
  const store = React.useContext(StoreContext);
  if (!store) throw new Error("useWorkspace must be used within WorkspaceProvider");
  React.useSyncExternalStore(
    React.useCallback((cb) => store.subscribe(cb), [store]),
    () => store.getVersion(),
    () => store.getVersion(),
  );
  return store;
}

/** Access the store WITHOUT subscribing (for imperative callbacks). */
export function useWorkspaceStore(): WorkspaceStore {
  const store = React.useContext(StoreContext);
  if (!store) throw new Error("useWorkspaceStore must be used within WorkspaceProvider");
  return store;
}

import type { WorkspaceData } from "../model/types.ts";

/**
 * Storage backend for the whole workspace document. The store treats this as an
 * opaque load/save pair, so swapping localStorage for an Electron JSON file or a
 * sync backend later is a one-file change.
 */
export interface PersistenceBackend {
  load(): Promise<WorkspaceData | null>;
  save(data: WorkspaceData): Promise<void>;
}

const DEFAULT_KEY = "octobase.workspace.v1";

export class LocalStoragePersistence implements PersistenceBackend {
  private readonly key: string;
  constructor(key: string = DEFAULT_KEY) {
    this.key = key;
  }

  async load(): Promise<WorkspaceData | null> {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WorkspaceData;
    } catch {
      return null;
    }
  }

  async save(data: WorkspaceData): Promise<void> {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(this.key, JSON.stringify(data));
  }
}

/** In-memory backend for tests and SSR-safe defaults. */
export class MemoryPersistence implements PersistenceBackend {
  private data: WorkspaceData | null = null;
  constructor(seed?: WorkspaceData) {
    this.data = seed ?? null;
  }
  async load(): Promise<WorkspaceData | null> {
    return this.data;
  }
  async save(data: WorkspaceData): Promise<void> {
    this.data = data;
  }
}

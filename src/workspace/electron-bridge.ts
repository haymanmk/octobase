import type { HighlightColor, TextAnchor } from "../lib/model/types.ts";

export interface CapturePayload {
  url: string;
  title: string;
  markdown: string;
  byline?: string;
  siteName?: string;
}

export interface HighlightPayload {
  id?: string;
  url: string;
  color: HighlightColor;
  anchor: TextAnchor;
  exact: string;
  note?: string;
}

/** Shape returned to the extension for reverse (app→page) sync. */
export interface HighlightSyncItem {
  id: string;
  color: HighlightColor;
  anchor: TextAnchor;
  exact: string;
}

export interface ExtensionInfo {
  port: number;
  token: string;
}

export interface OctobaseCaptureBridge {
  getInfo: () => Promise<ExtensionInfo>;
  onCapture: (cb: (d: CapturePayload) => void) => void;
  onHighlight: (cb: (d: HighlightPayload) => void) => void;
  onHighlightRemove: (cb: (d: { id: string }) => void) => void;
  onHighlightsRequest: (cb: (d: { reqId: string; url: string }) => void) => void;
  respondHighlights: (reqId: string, items: HighlightSyncItem[]) => void;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getCaptureBridge(): OctobaseCaptureBridge | undefined {
  return (window as unknown as { octobaseCapture?: OctobaseCaptureBridge })
    .octobaseCapture;
}

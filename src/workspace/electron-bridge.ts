import type { HighlightColor, TextAnchor } from "../lib/model/types.ts";

export interface CapturePayload {
  url: string;
  title: string;
  markdown: string;
  byline?: string;
  siteName?: string;
}

export interface HighlightPayload {
  url: string;
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
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getCaptureBridge(): OctobaseCaptureBridge | undefined {
  return (window as unknown as { octobaseCapture?: OctobaseCaptureBridge })
    .octobaseCapture;
}

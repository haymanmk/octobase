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

/** A highlight dragged out of the browser pane, as forwarded by main.js. */
export interface HighlightDroppedPayload {
  highlightId: string;
  text: string;
  sourceUrl: string;
  color: HighlightColor;
  tags: string[];
  notes: string;
  /** Drop point in renderer-local screen coordinates. */
  x: number;
  y: number;
}

export interface OctobaseDropBridge {
  onHighlightDropped: (cb: (d: HighlightDroppedPayload) => void) => void;
  removeHighlightDroppedListener: () => void;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getDropBridge(): OctobaseDropBridge | undefined {
  const api = (window as unknown as { electronAPI?: Partial<OctobaseDropBridge> })
    .electronAPI;
  return api?.onHighlightDropped ? (api as OctobaseDropBridge) : undefined;
}

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/**
 * Docking + chrome controls for the native browser pane. The shell reports
 * where its viewer slot sits; main.js keeps the WebContentsView glued to it.
 */
export interface OctobaseViewerBridge {
  paneSetBounds: (rect: PaneRect) => void;
  paneSetVisible: (visible: boolean) => void;
  browserNavigate: (input: string) => void;
  browserBack: () => void;
  browserForward: () => void;
  browserReload: () => void;
  onBrowserState: (cb: (s: BrowserState) => void) => void;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getViewerBridge(): OctobaseViewerBridge | undefined {
  const api = (window as unknown as { electronAPI?: Partial<OctobaseViewerBridge> })
    .electronAPI;
  return api?.paneSetBounds ? (api as OctobaseViewerBridge) : undefined;
}

/** A clipped region captured by main.js, ready to become an image card. */
export interface ClipCapturedPayload {
  /** File name inside userData/clips. */
  file: string;
  w: number;
  h: number;
  sourceUrl: string;
  title: string;
}

export interface OctobaseClipBridge {
  clipStart: () => void;
  onClipCaptured: (cb: (d: ClipCapturedPayload) => void) => void;
  onClipCancelled: (cb: () => void) => void;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getClipBridge(): OctobaseClipBridge | undefined {
  const api = (window as unknown as { electronAPI?: Partial<OctobaseClipBridge> })
    .electronAPI;
  return api?.clipStart ? (api as OctobaseClipBridge) : undefined;
}

/** Renderer-side URL for a clip file served by the octobase-clip protocol. */
export function clipUrl(file: string): string {
  return `octobase-clip://c/${file}`;
}

/** A PDF copied into app storage by main.js, ready to become a pdf card. */
export interface PdfImportResult {
  /** File name inside userData/pdfs. */
  file: string;
  /** Base name of the original file, for the card title. */
  name: string;
}

export interface OctobasePdfBridge {
  pdfOpen: () => Promise<PdfImportResult | null>;
  pdfImport: (absPath: string) => Promise<PdfImportResult | null>;
  pdfDelete: (file: string) => Promise<boolean>;
  /** Absolute path of a dropped File object. */
  pathForFile: (file: File) => string;
  /** Persist a renderer-cropped PNG data URL; returns the clip file ref. */
  clipSave: (payload: { dataUrl: string; w: number; h: number }) =>
    Promise<{ file: string; w: number; h: number } | null>;
  /** Cache of parsed whole-document PDF markdown (for the in-app AI). */
  pdfTextSave: (file: string, markdown: string) => Promise<boolean>;
  pdfTextLoad: (file: string) => Promise<string | null>;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getPdfBridge(): OctobasePdfBridge | undefined {
  const api = (window as unknown as { electronAPI?: Partial<OctobasePdfBridge> })
    .electronAPI;
  return api?.pdfOpen ? (api as OctobasePdfBridge) : undefined;
}

/** Renderer-side URL for a PDF file served by the octobase-pdf protocol. */
export function pdfUrl(file: string): string {
  return `octobase-pdf://p/${file}`;
}

// ---- in-app AI --------------------------------------------------------------

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OctobaseAiBridge {
  aiStatus: () => Promise<{ hasKey: boolean; model: string }>;
  aiSetKey: (key: string | null) => Promise<{ ok: boolean; error?: string }>;
  aiSetModel: (model: string) => Promise<{ ok: boolean; model?: string }>;
  aiTest: () => Promise<{ ok: boolean; error?: string }>;
  /** Streams via onAiChatDelta; resolves when the stream ends. */
  aiChat: (reqId: string, messages: AiChatMessage[]) => Promise<{ ok: boolean; error?: string }>;
  aiChatAbort: (reqId: string) => void;
  onAiChatDelta: (cb: (d: { reqId: string; delta: string }) => void) => void;
}

/** Present only inside the Electron renderer (exposed by preload.js). */
export function getAiBridge(): OctobaseAiBridge | undefined {
  const api = (window as unknown as { electronAPI?: Partial<OctobaseAiBridge> })
    .electronAPI;
  return api?.aiChat ? (api as OctobaseAiBridge) : undefined;
}

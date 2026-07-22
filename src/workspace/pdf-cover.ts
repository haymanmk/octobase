import type { PdfCard } from "../lib/model/types.ts";
import type { WorkspaceStore } from "../lib/store/workspace-store.ts";
import { getPdfBridge, pdfUrl } from "./electron-bridge.ts";

/** Cover width in CSS px; tall pages keep their aspect ratio. */
const COVER_W = 480;

/**
 * Render the PDF's first page into a PNG in the clips store and remember it
 * on the card — the card's cover on boards and library tiles. Runs at import
 * and lazily backfills older cards when their PDF is opened. No-op outside
 * Electron (no clip persistence) or when a cover already exists.
 */
export async function ensurePdfCover(card: PdfCard, store: WorkspaceStore): Promise<void> {
  if (card.cover) return;
  const bridge = getPdfBridge();
  if (!bridge) return;
  try {
    const { loadPdf } = await import("./reader/pdf-doc.ts");
    const doc = await loadPdf(pdfUrl(card.file));
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_W / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // "print" intent: display-intent tasks stall in occluded windows.
    await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
    const saved = await bridge.clipSave({
      dataUrl: canvas.toDataURL("image/png"),
      w: canvas.width,
      h: canvas.height,
    });
    if (saved) store.setPdfCover(card.id, saved.file);
  } catch {
    /* unreadable PDF — the card just keeps its text-only face */
  }
}

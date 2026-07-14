import { getPdfBridge, pdfUrl } from "./electron-bridge.ts";
import type { PdfCard } from "../lib/model/types.ts";

/**
 * The parsed markdown for a PDF card — from the disk cache when present,
 * extracted (and cached) on first use otherwise. Import kicks this off in
 * the background so the text is usually ready before anyone asks.
 */
export async function ensurePdfText(card: PdfCard): Promise<string | null> {
  const bridge = getPdfBridge();
  if (!bridge) return null;
  const cached = await bridge.pdfTextLoad(card.file);
  if (cached) return cached;
  try {
    const { loadPdf } = await import("./reader/pdf-doc.ts");
    const { extractPdfMarkdown } = await import("./reader/pdf-text.ts");
    const doc = await loadPdf(pdfUrl(card.file));
    const markdown = await extractPdfMarkdown(doc, card.title);
    void doc.destroy();
    void bridge.pdfTextSave(card.file, markdown);
    return markdown;
  } catch (err) {
    console.warn("[pdf-text] extraction failed for", card.file, err);
    return null;
  }
}

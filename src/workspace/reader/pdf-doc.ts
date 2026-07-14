/**
 * Thin pdf.js wrapper for the PDF reader: worker setup, document loading,
 * page rendering (canvas + selectable text layer), and text extraction that
 * matches the text layer's DOM (so anchors and search share one coordinate
 * system — character offsets into the page's textContent).
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ url }).promise;
}

/**
 * Plain text of a page, concatenated exactly like the rendered text layer's
 * textContent (span strings back to back), so offsets computed against either
 * agree.
 */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return (content.items as Array<{ str?: string }>)
    .map((it) => it.str ?? "")
    .join("");
}

/**
 * Render one page at `scale` into a canvas plus a selectable text layer.
 * Returns the CSS size the host container should take.
 */
export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  textLayerDiv: HTMLDivElement,
  scale: number,
): Promise<{ width: number; height: number }> {
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  // 100% of the host, not viewport px: the host div is sized to the same
  // viewport size when this render lands, and if the scale changes before the
  // next render completes the stale bitmap stretches with the div instead of
  // detaching from the overlay geometry (highlight bands, clip frames).
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const ctx = canvas.getContext("2d")!;
  // The transform upscales onto the HiDPI backing store. intent "print":
  // display-intent tasks step via requestAnimationFrame, which Chromium
  // freezes for occluded windows — a render started (or interrupted) while
  // the window is hidden would hang indefinitely, wedging the page at a
  // stale scale. Print-intent tasks step via microtasks and always finish.
  await page.render({
    canvasContext: ctx,
    viewport,
    intent: "print",
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;

  textLayerDiv.textContent = "";
  textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
  textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textLayerDiv,
    viewport,
  });
  await layer.render();
  return { width: viewport.width, height: viewport.height };
}

/** Base (scale 1) page sizes, for layout before pages render. */
export async function pageBaseSizes(
  doc: PDFDocumentProxy,
): Promise<Array<{ width: number; height: number }>> {
  const sizes: Array<{ width: number; height: number }> = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return sizes;
}

/** Resolve an outline destination to a 0-based page index (or null). */
export async function destToPageIndex(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    return await doc.getPageIndex(explicit[0]);
  } catch {
    return null;
  }
}

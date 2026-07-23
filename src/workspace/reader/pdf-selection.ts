/**
 * Port of the pdf.js viewer's text-selection guard (web/text_layer_builder.js)
 * for our raw TextLayer usage. The text layer is absolutely-positioned spans
 * with blank gaps between them; when a drag-selection wanders into a gap,
 * Chromium resolves the boundary to a span far away in document order and the
 * selection balloons across lines or whole paragraphs. Upstream fixes this by
 * keeping a full-size, user-select:none `endOfContent` div inserted right
 * next to the selection's moving boundary while a selection is in flight —
 * the browser then anchors into it instead of jumping.
 */

/** Live text layers → their endOfContent div. */
const layers = new Map<HTMLElement, HTMLElement>();
let abortCtrl: AbortController | null = null;
let prevRange: Range | null = null;
let pointerDown = false;

const reset = (end: HTMLElement, layer: HTMLElement): void => {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
};

/** Drop layers that left the DOM (reader unmounts, page churn). */
const purge = (): void => {
  for (const layer of [...layers.keys()]) {
    if (!layer.isConnected) layers.delete(layer);
  }
  if (layers.size === 0) {
    abortCtrl?.abort();
    abortCtrl = null;
    prevRange = null;
  }
};

const resetAll = (): void => {
  purge();
  layers.forEach(reset);
};

/**
 * (Re-)arm the guard on a freshly rendered text layer. Renders wipe the
 * layer's children, so the endOfContent div is recreated on every call.
 */
export function attachSelectionGuard(textLayer: HTMLElement): void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  textLayer.append(end);
  if (!layers.has(textLayer)) {
    textLayer.addEventListener("mousedown", () => {
      textLayer.classList.add("selecting");
    });
  }
  layers.set(textLayer, end);
  enableGlobalListeners();
}

function enableGlobalListeners(): void {
  if (abortCtrl) return;
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  document.addEventListener("pointerdown", () => { pointerDown = true; }, { signal });
  document.addEventListener("pointerup", () => { pointerDown = false; resetAll(); }, { signal });
  window.addEventListener("blur", () => { pointerDown = false; resetAll(); }, { signal });
  document.addEventListener("keyup", () => { if (!pointerDown) resetAll(); }, { signal });

  document.addEventListener("selectionchange", () => {
    purge();
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      layers.forEach(reset);
      return;
    }

    // Layers the selection touches get the `selecting` state; others reset.
    const active = new Set<HTMLElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of layers.keys()) {
        if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
    }
    for (const [layer, end] of layers) {
      if (active.has(layer)) layer.classList.add("selecting");
      else reset(end, layer);
    }

    // Chromium: park the endOfContent div beside the boundary being dragged.
    // (Firefox needs none of this; Electron is always Chromium.)
    // Only while the pointer is actually down: selectionchange events are
    // queued and can land after mouseup — re-inserting the div then would
    // shuffle the layer's child list under the reader's captured selection
    // range and teleport its element-offset boundary (a boundary inside the
    // moved div lands at the layer end → whole-page highlights).
    if (!pointerDown) return;
    const range = selection.getRangeAt(0);
    const modifyStart =
      prevRange != null &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode as Node;
    const layer = (anchor as Element).parentElement?.closest?.(".ws-pdf-text") as HTMLElement | null;
    const end = layer ? layers.get(layer) : undefined;
    if (end && layer) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      (anchor as Element).parentElement!.insertBefore(
        end,
        modifyStart ? (anchor as Element) : (anchor as Element).nextSibling,
      );
    }
    prevRange = range.cloneRange();
  }, { signal });
}

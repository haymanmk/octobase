/**
 * Insertion caret for dropping a card between the line blocks of a note.
 * Both drag flavors (HTML5 library-tile drags and board ⌥-drags) hit-test the
 * DOM directly, so a single fixed-position caret element serves the whole
 * app. The index reported counts markdown blocks (blank-line separated),
 * which MarkdownView renders 1:1 as the .ws-md element's children.
 */

function blocksOf(hostCardEl: HTMLElement): HTMLElement[] {
  const md = hostCardEl.querySelector(".ws-card-body .ws-md");
  return md ? ([...md.children] as HTMLElement[]) : [];
}

/** The block index a drop at clientY should insert before. */
export function insertionIndexAt(hostCardEl: HTMLElement, clientY: number): number {
  const blocks = blocksOf(hostCardEl);
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return blocks.length;
}

let caretEl: HTMLDivElement | null = null;

/** Show the caret for a hover at clientY; returns the insertion index. */
export function showDropCaret(hostCardEl: HTMLElement, clientY: number): number {
  const index = insertionIndexAt(hostCardEl, clientY);
  const blocks = blocksOf(hostCardEl);
  const box = (hostCardEl.querySelector(".ws-card-body") ?? hostCardEl).getBoundingClientRect();
  let y: number;
  if (blocks.length === 0) y = box.top + 4;
  else if (index === 0) y = blocks[0].getBoundingClientRect().top - 2;
  else if (index >= blocks.length) y = blocks[blocks.length - 1].getBoundingClientRect().bottom + 2;
  else {
    const prev = blocks[index - 1].getBoundingClientRect();
    const next = blocks[index].getBoundingClientRect();
    y = (prev.bottom + next.top) / 2;
  }
  showCaretLine(box.left + 6, Math.max(0, box.width - 12), Math.max(box.top, Math.min(box.bottom, y)));
  return index;
}

/** Low-level caret placement in client coordinates (fixed overlay). */
export function showCaretLine(left: number, width: number, top: number): void {
  if (!caretEl) {
    caretEl = document.createElement("div");
    caretEl.className = "ws-drop-caret";
    document.body.appendChild(caretEl);
  }
  caretEl.style.left = `${left}px`;
  caretEl.style.width = `${width}px`;
  caretEl.style.top = `${top}px`;
}

export function hideDropCaret(): void {
  caretEl?.remove();
  caretEl = null;
}

let ghostEl: HTMLDivElement | null = null;

/** Floating text ghost that follows a pointer drag (embeds dragged out of a
 *  card's read view). Same singleton pattern as the caret. */
export function showDragGhost(text: string): void {
  if (!ghostEl) {
    ghostEl = document.createElement("div");
    ghostEl.className = "ws-drag-ghost";
    ghostEl.style.position = "fixed";
    ghostEl.style.pointerEvents = "none";
    ghostEl.style.zIndex = "95";
    document.body.appendChild(ghostEl);
  }
  ghostEl.textContent = text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function moveDragGhost(x: number, y: number): void {
  if (!ghostEl) return;
  ghostEl.style.left = `${x + 10}px`;
  ghostEl.style.top = `${y + 12}px`;
}

export function hideDragGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}

// Handshake between card-drop targets (canvas, cards) and drag sources that
// need to know whether their drop landed (the editor's embed-block grip):
// dataTransfer.dropEffect is unreliable across browsers/synthetic events.
let cardDropHandled = false;

/** A drop target accepted a CARD_DRAG_MIME payload this gesture. */
export function markCardDropHandled(): void {
  cardDropHandled = true;
}

/** Read-and-clear the handshake (call from the source's dragend). */
export function consumeCardDropHandled(): boolean {
  const v = cardDropHandled;
  cardDropHandled = false;
  return v;
}

/** The embeddable card element under a screen point (excluding one card id) —
 *  shared by board drags, reader hold-drags, and browser highlight drops. */
export function embedHostAt(
  clientX: number,
  clientY: number,
  excludeCardId?: string,
): HTMLElement | null {
  return (
    document
      .elementsFromPoint(clientX, clientY)
      .map((el) => el.closest?.(".ws-card") as HTMLElement | null)
      .find(
        (el) =>
          el && el.dataset.embeddable === "true" && el.dataset.cardId !== excludeCardId,
      ) ?? null
  );
}

/**
 * Highlighter widget entry point for building standalone bundle.
 * Here we inject the custom web component into another website via shadow DOM.
 */
import {LitElement, html, css, unsafeCSS } from 'lit';
import { pillCss } from './toolbar-ui';
import { customElement } from 'lit/decorators.js';
import 'rangy/lib/rangy-classapplier';
import 'rangy/lib/rangy-highlighter';
import 'rangy/lib/rangy-serializer';
import rangy from 'rangy';
import { HIGHLIGHT_COLORS, type HighlightColor, type Highlight } from '../../types/highlight';
import type { TextAnchor } from '../../lib/model/types';
import { applyContrastGuard, classNameFor, PALETTE } from './colors';
import { getHighlightDragPayload, stampHighlightGroup } from './highlight-id';
import { describeAnchorFromRange } from '../../lib/anchor/text-anchor';
import { createAnchoredOverlay, type OverlayHighlight } from './anchored-overlay';
import { injectGlobalStyles } from './widget-styles';
import './edit-form';
import './undo-toast';

// Declare the electron API
declare global {
  interface Window {
    electronAPI?: {
      sendDragText: (data: { text: string; sourceUrl: string; cursorX: number; cursorY: number; highlightId: string }) => void;
      sendDragPosition: (data: { x: number; y: number }) => void;
      sendDragEnd: (data: { x: number; y: number }) => void;
      loadHighlights: (url: string) => Promise<Highlight[]>;
      saveHighlight: (highlight: Highlight) => Promise<{ ok: true }>;
      deleteHighlight: (id: string) => Promise<{ ok: true }>;
      listTags: () => Promise<string[]>;
      onHighlightUpdated: (callback: (h: Highlight) => void) => void;
      onHighlightAdded?: (callback: (h: Highlight) => void) => void;
      onHighlightDeleted: (callback: (data: { id: string }) => void) => void;
      onClipEditForm?: (callback: (d: {
        file: string;
        rect: { x: number; y: number; width: number; height: number };
      }) => void) => void;
      clipAnnotate?: (data: {
        file: string;
        color?: HighlightColor;
        tags?: string[];
        note?: string;
      }) => void;
    };
  }
}

// Create the host element that will live in the website's DOM
const hostID = 'octobase-widget-root';
@customElement(hostID)
class HostElement extends LitElement {
  render() {
    return html``;
  }
}
let hostElement = document.getElementById(hostID);
if (!hostElement) {
  hostElement = new HostElement();
  document.body.appendChild(hostElement);
}

// Create Shadow DOM for isolation
const shadowRoot = hostElement.shadowRoot || hostElement.attachShadow({ mode: 'open' });

// Module-level flag to prevent handleTextSelection from firing during drag
let isDraggingHighlight = false;

// Defensive cleanup: if a previous drag flow disabled body pointer events
// and didn't restore them (e.g., onDragEnd missed the mouseup), we'd block
// every click on the page. Restore on every global mouseup we observe while
// not actively dragging.
window.addEventListener('mouseup', () => {
  if (!isDraggingHighlight && document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = '';
    console.warn('[octobase-highlighter] restored stuck body.pointer-events:none');
  }
}, true);


// === Edit panel (opened by clicking a saved highlight) ===
let editPanelEl: HTMLElement | null = null;
let editPanelTargetId: string | null = null;
let editPanelLocal: { color: HighlightColor | null; tags: string[]; notes: string } | null = null;

async function openEditPanel(highlightId: string, anchorRect: DOMRect): Promise<void> {
  closeEditPanel();
  const record = await loadHighlightById(highlightId);
  if (!record) return;

  const form = document.createElement('octo-edit-form') as HTMLElement & {
    color: HighlightColor | null;
    tags: string[];
    notes: string;
    suggestions: string[];
    showDelete: boolean;
  };
  form.color = record.color;
  form.tags = [...record.tags];
  form.notes = record.notes;
  form.suggestions = (await window.electronAPI?.listTags()) ?? [];
  form.showDelete = true;

  form.style.position = 'absolute';
  form.style.top = `${anchorRect.bottom + window.scrollY + 6}px`;
  form.style.left = `${Math.min(anchorRect.left + window.scrollX, window.scrollX + window.innerWidth - 320)}px`;
  form.style.zIndex = '10000';

  editPanelLocal = { color: record.color, tags: [...record.tags], notes: record.notes };
  editPanelTargetId = highlightId;

  form.addEventListener('color-changed', async (e: Event) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    const c = (e as CustomEvent).detail.color as HighlightColor;
    editPanelLocal.color = c;
    await changeHighlightColor(editPanelTargetId, c);
  });
  form.addEventListener('tags-changed', async (e: Event) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    editPanelLocal.tags = (e as CustomEvent).detail.tags;
    await persistEdit();
  });
  form.addEventListener('notes-changed', async (e: Event) => {
    if (!editPanelTargetId || !editPanelLocal) return;
    editPanelLocal.notes = (e as CustomEvent).detail.notes;
    await persistEdit();
  });
  form.addEventListener('delete-requested', async () => {
    const id = editPanelTargetId!;
    closeEditPanel();
    await deleteHighlightWithUndo(id);
  });
  // Field blurs (which persist) fire before the click lands on Done.
  form.addEventListener('done-requested', () => closeEditPanel());

  document.body.appendChild(form);
  editPanelEl = form;
}

function closeEditPanel(): void {
  if (editPanelEl && editPanelEl.parentNode) editPanelEl.parentNode.removeChild(editPanelEl);
  editPanelEl = null;
  editPanelTargetId = null;
  editPanelLocal = null;
}

// === Post-clip edit form (offered right after ✂ clipping a region) ===
// Same affordances as a highlight — color, tags, note — writing to the clip's
// image card in the workspace via clip:annotate. One shot: Esc or an outside
// click dismisses it; nothing persists on the page.
let clipFormEl: HTMLElement | null = null;
let clipFrameEl: HTMLElement | null = null;

async function openClipForm(d: {
  file: string;
  rect: { x: number; y: number; width: number; height: number };
}): Promise<void> {
  clipFormEl?.remove();
  clipFormEl = null;
  clipFrameEl?.remove();
  clipFrameEl = null;
  closeEditPanel();

  // Mark the clipped region while the form is up — the capture overlay had
  // to remove itself before capturePage, so without this the user loses
  // sight of what they just clipped. One shot: it leaves with the form
  // (live pages reflow, so nothing may persist).
  const frame = document.createElement('div');
  Object.assign(frame.style, {
    position: 'fixed',
    left: `${d.rect.x}px`,
    top: `${d.rect.y}px`,
    width: `${d.rect.width}px`,
    height: `${d.rect.height}px`,
    border: '1.5px dashed #ef476f',
    borderRadius: '3px',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.55)',
    pointerEvents: 'none',
    zIndex: '2147483646',
  });
  document.body.appendChild(frame);
  clipFrameEl = frame;

  const form = document.createElement('octo-edit-form') as HTMLElement & {
    color: HighlightColor | null;
    tags: string[];
    notes: string;
    suggestions: string[];
    showDelete: boolean;
  };
  form.color = 'blue'; // image cards default to blue
  form.tags = [];
  form.notes = '';
  form.suggestions = (await window.electronAPI?.listTags()) ?? [];
  form.showDelete = false;
  form.style.position = 'fixed';
  form.style.left = `${Math.min(Math.max(8, d.rect.x), window.innerWidth - 330)}px`;
  form.style.top = `${Math.min(d.rect.y + d.rect.height + 8, window.innerHeight - 260)}px`;
  form.style.zIndex = '2147483647';

  const send = (patch: { color?: HighlightColor; tags?: string[]; note?: string }) =>
    window.electronAPI?.clipAnnotate?.({ file: d.file, ...patch });
  form.addEventListener('color-changed', (e: Event) => send({ color: (e as CustomEvent).detail.color }));
  form.addEventListener('tags-changed', (e: Event) => send({ tags: (e as CustomEvent).detail.tags }));
  form.addEventListener('notes-changed', (e: Event) => send({ note: (e as CustomEvent).detail.notes }));
  form.addEventListener('done-requested', () => dismiss());

  const dismiss = () => {
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
    clipFormEl?.remove();
    clipFormEl = null;
    clipFrameEl?.remove();
    clipFrameEl = null;
  };
  const onOutside = (ev: MouseEvent) => {
    if (clipFormEl && !ev.composedPath().includes(clipFormEl)) dismiss();
  };
  const onEsc = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') dismiss();
  };
  // Next tick, so the pointerup that finished the clip drag can't dismiss it.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  }, 0);

  document.body.appendChild(form);
  clipFormEl = form;
}

window.electronAPI?.onClipEditForm?.((d) => { void openClipForm(d); });

async function persistEdit(): Promise<void> {
  // Snapshot before any await — the panel may close (and clear these globals)
  // while loadHighlightById is in flight, e.g. when the same click that blurs
  // the notes textarea also lands outside the panel.
  const id = editPanelTargetId;
  const local = editPanelLocal;
  if (!id || !local) return;
  const record = await loadHighlightById(id);
  if (!record) return;
  await window.electronAPI?.saveHighlight({
    ...record,
    color: local.color ?? record.color,
    tags: local.tags,
    notes: local.notes,
    updatedAt: Date.now(),
  });
}

async function deleteHighlightWithUndo(id: string): Promise<void> {
  const record = await loadHighlightById(id);
  if (!record) return;

  // Unwrap and remove every fragment of this highlight.
  const fragments = Array.from(document.querySelectorAll(`[data-octobase-highlight-id="${id}"]`)) as HTMLElement[];
  for (const el of fragments) {
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
    el.remove();
  }
  anchoredRecords = anchoredRecords.filter((r) => r.id !== id);
  notedFragmentIds.delete(id);
  repaintAnchored();
  await window.electronAPI?.deleteHighlight(id);

  // Toast with Undo.
  const toast = document.createElement('octo-undo-toast');
  let undone = false;
  toast.addEventListener('undo-clicked', async () => {
    undone = true;
    toast.remove();
    try {
      const range = rangy.deserializeRange(record.anchor.serialized, document.body);
      const sel = rangy.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const h = rangy.createHighlighter();
      h.addClassApplier(appliers[record.color]);
      h.highlightSelection(classNameFor(record.color));
      sel.removeAllRanges();
      const restored = document.querySelectorAll(`.${classNameFor(record.color)}:not([data-octobase-highlight-id])`);
      for (const el of restored) {
        const htmlEl = el as HTMLElement;
        htmlEl.dataset.octobaseHighlightId = record.id;
        htmlEl.dataset.octobaseHighlightText = record.text;
      }
      applyContrastGuard(restored);
      await window.electronAPI?.saveHighlight({ ...record, updatedAt: Date.now() });
    } catch (err) {
      console.warn('[octobase-highlighter] undo re-apply failed', err);
    }
  });
  document.body.appendChild(toast);
  setTimeout(() => { if (!undone) toast.remove(); }, 5000);
}

// Click outside the edit panel (and not on the menu button that may have
// triggered it) → close. Also Esc closes from anywhere.
document.addEventListener('mousedown', (e) => {
  if (!editPanelEl) return;
  if (editPanelEl.contains(e.target as Node)) return;
  closeEditPanel();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editPanelEl) closeEditPanel();
});

/**
 * Carry a highlight out of the page and onto the whiteboard: hand the text to
 * the host, then relay the pointer until it is dropped. Shared by the two
 * kinds of painted highlight — Rangy fragments and anchored ranges.
 */
function launchHighlightDrag(text: string, highlightId: string, startX: number, startY: number,
                             refocus?: () => void) {
  if (text.length === 0) return;
  window.electronAPI?.sendDragText({ text, sourceUrl: window.location.href, cursorX: startX, cursorY: startY, highlightId });
  window.postMessage({
    type: 'drag-drop-text-selection',
    data: { text, sourceUrl: window.location.href, cursorX: startX, cursorY: startY, highlightId },
  }, '*');
  // Let the overlay own the cursor while the ghost is in flight.
  document.body.style.pointerEvents = 'none';
  const onDragMove = (e: MouseEvent) => window.electronAPI?.sendDragPosition({ x: e.clientX, y: e.clientY });
  const onDragEnd = (e: MouseEvent) => {
    window.electronAPI?.sendDragEnd({ x: e.clientX, y: e.clientY });
    document.body.style.pointerEvents = '';
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    refocus?.();
  };
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  requestAnimationFrame(() => { isDraggingHighlight = false; });
}

// Attaches hold-to-drag behavior to a single highlight fragment element.
function attachFragmentBehavior(htmlEl: HTMLElement) {
  htmlEl.addEventListener('pointerdown', (downEvent) => {
    if (downEvent.button !== 0) return; // Only left click

    const holdDuration = 250; // ms to hold before drag intent
    const moveCancel = 5; // px movement cancels the hold
    const startX = downEvent.clientX;
    const startY = downEvent.clientY;

    // Capture pointer so move/up events don't leak to window listeners
    htmlEl.setPointerCapture(downEvent.pointerId);
    isDraggingHighlight = true;

    const cleanup = () => {
      clearTimeout(holdTimer);
      htmlEl.removeEventListener('pointermove', onPointerMove);
      htmlEl.removeEventListener('pointerup', onPointerUp);
      try { htmlEl.releasePointerCapture(downEvent.pointerId); } catch { /* already released */ }
    };

    const triggerDrag = () => {
      const { text, highlightId } = getHighlightDragPayload(htmlEl);
      if (text.length === 0) { cleanup(); return; }
      window.electronAPI?.sendDragText({ text, sourceUrl: window.location.href, cursorX: startX, cursorY: startY, highlightId });
      window.postMessage({
        type: 'drag-drop-text-selection',
        data: { text, sourceUrl: window.location.href, cursorX: startX, cursorY: startY, highlightId }
      }, '*');
      // Release capture so the overlay can track the pointer
      cleanup();

      // Disable pointer events on the right view's body so Chromium yields cursor control to overlay
      document.body.style.pointerEvents = 'none';

      // Continue tracking mouse in this view and relay via IPC
      const onDragMove = (e: MouseEvent) => {
        window.electronAPI?.sendDragPosition({ x: e.clientX, y: e.clientY });
      };
      const onDragEnd = (e: MouseEvent) => {
        window.electronAPI?.sendDragEnd({ x: e.clientX, y: e.clientY });
        // Restore pointer events to right view
        document.body.style.pointerEvents = '';
        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
        // Force input focus back to this view so it can listen to mouse again
        htmlEl.focus();
      };
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);

      // Reset flag after a tick to let any queued events pass
      requestAnimationFrame(() => { isDraggingHighlight = false; });
    };

    // Start hold timer — if it fires, user intends to drag
    const holdTimer = setTimeout(triggerDrag, holdDuration);

    // If user moves too far during the hold, cancel (they're selecting text)
    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - startX);
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (deltaX > moveCancel || deltaY > moveCancel) {
        cleanup();
        isDraggingHighlight = false;
      }
    };

    // If user lifts before timer, it's a click — cancel
    const onPointerUp = () => {
      cleanup();
      isDraggingHighlight = false;
    };

    htmlEl.addEventListener('pointermove', onPointerMove);
    htmlEl.addEventListener('pointerup', onPointerUp);
  });
}

function makeApplier(color: HighlightColor) {
  return rangy.createClassApplier(classNameFor(color), {
    onElementCreate: (el: Element) => attachFragmentBehavior(el as HTMLElement),
  });
}

const appliers: Record<HighlightColor, ReturnType<typeof rangy.createClassApplier>> = Object.fromEntries(
  HIGHLIGHT_COLORS.map((c) => [c, makeApplier(c)]),
) as Record<HighlightColor, ReturnType<typeof rangy.createClassApplier>>;

async function applyHighlightFromSelection(color: HighlightColor): Promise<string | null> {
  const sel = rangy.getSelection();
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString();
  if (!text.trim()) return null;
  // Capture the native selection before Rangy splits/wraps its text nodes.
  const nativeRange = window.getSelection()?.getRangeAt(0);
  const textAnchor = nativeRange ? describeAnchorFromRange(document.body, nativeRange) : null;
  if (!textAnchor) return null;
  const serialized = rangy.serializeRange(range, true, document.body);
  const id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const highlighter = rangy.createHighlighter();
  highlighter.addClassApplier(appliers[color]);
  highlighter.highlightSelection(classNameFor(color));

  const fragments = Array.from(
    document.querySelectorAll(`.${classNameFor(color)}:not([data-octobase-highlight-id])`),
  ) as HTMLElement[];
  if (fragments.length > 0) {
    stampHighlightGroup(fragments, text, () => id);
    applyContrastGuard(fragments);
  }
  sel.removeAllRanges();

  const now = Date.now();
  // Two anchors: the Rangy range re-applies exactly here, the text anchor
  // travels — it is what the workspace store, the reader panes and the
  // capture extension all read.
  await window.electronAPI?.saveHighlight({
    id, text, sourceUrl: window.location.href, color,
    tags: [], notes: '',
    anchor: { serialized },
    textAnchor,
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function changeHighlightColor(id: string, color: HighlightColor): Promise<void> {
  const fragments = Array.from(document.querySelectorAll(`[data-octobase-highlight-id="${id}"]`)) as HTMLElement[];
  if (fragments.length === 0) {
    // Painted as a range, not elements: repaint it in the new colour.
    const item = anchoredRecords.find((r) => r.id === id);
    if (!item) return;
    addAnchored({ ...item, color });
    const stored = await loadHighlightById(id);
    if (stored) await window.electronAPI?.saveHighlight({ ...stored, color, updatedAt: Date.now() });
    return;
  }
  for (const el of fragments) {
    for (const c of HIGHLIGHT_COLORS) el.classList.remove(classNameFor(c));
    el.classList.add(classNameFor(color));
  }
  const record = await loadHighlightById(id);
  if (record) {
    await window.electronAPI?.saveHighlight({ ...record, color, updatedAt: Date.now() });
  }
}

async function loadHighlightById(id: string): Promise<Highlight | null> {
  const all = await window.electronAPI?.loadHighlights(window.location.href);
  return all?.find((h) => h.id === id) ?? null;
}

// highlighter component which wrpaps around the selected text or even elements
@customElement('highlighter-component')
export class HighlighterComponent extends LitElement {
  static styles = css`
    :host {
      background-color: yellow;
      color: black;
      border-radius: 5px;
    }
    ::slotted(*) {
      background-color: transparent;
    }
    highlighted-text {
      background-color: yellow;
    }
  `;

  render() {
    return html`<slot></slot>`;
  }
}

// Define the highlighter widget
@customElement('highlighter-widget')
export class HighlighterWidget extends LitElement {
  // Look and feel comes from the shared toolbar module so the widget, the
  // extension, and the in-app reader can never drift apart.
  static styles = [
    css`
      :host {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: auto;
        isolation: isolate;
      }
    `,
    unsafeCSS(pillCss()),
  ];

  // Plain class fields rather than @property/@state — Vite library mode parses
  // the entry file with Rollup's acorn parser, which does not yet recognise the
  // standard-decorator `accessor` keyword. Mutations call requestUpdate().
  visible: boolean = false;
  mode: 'pill' | 'expanded' = 'pill';
  private pulseColors = false;
  /** The pill shows the default colour alone until this opens the palette. */
  private paletteOpen = false;
  private currentId: string | null = null;
  private currentColor: HighlightColor | null = null;
  private currentTags: string[] = [];
  private currentNotes: string = '';
  private suggestions: string[] = [];

  /** True once this widget owns an applied highlight (pill or form). */
  get hasHighlight(): boolean {
    return this.currentId !== null;
  }

  updateWidgetPosition(rect: DOMRect) {
    this.style.position = 'absolute';
    this.style.top = `${rect.bottom + window.scrollY + 10}px`;
    this.style.left = `${rect.left + window.scrollX}px`;
    this.style.zIndex = '2147483647';
    this.style.pointerEvents = 'auto';
  }

  show() {
    this.visible = true;
    this.mode = 'pill';
    // Deliberately not folding the palette here: every mouse-up re-runs the
    // selection handler and calls show() again, which would close the palette
    // the moment "⋯" opened it. It folds on hide/reset instead.
    this.requestUpdate();
  }

  hide() {
    this.visible = false;
    this.paletteOpen = false;
    this.requestUpdate();
  }

  reset() {
    this.currentId = null;
    this.currentColor = null;
    this.currentTags = [];
    this.currentNotes = '';
    this.mode = 'pill';
    this.paletteOpen = false;
    this.requestUpdate();
  }

  private async onSwatch(color: HighlightColor) {
    if (!this.currentId) {
      const id = await applyHighlightFromSelection(color);
      if (!id) return;
      this.currentId = id;
      this.currentColor = color;
      this.currentTags = [];
      this.currentNotes = '';
      this.suggestions = (await window.electronAPI?.listTags()) ?? [];
      // Stay a pill: highlighting is one gesture. "+ note" expands into the
      // tags/note form only when asked.
      this.requestUpdate();
    } else {
      await changeHighlightColor(this.currentId, color);
      this.currentColor = color;
      this.requestUpdate();
    }
  }

  private async onAddNote() {
    if (!this.currentId) await this.onSwatch('yellow');
    if (this.currentId) { this.mode = 'expanded'; this.requestUpdate(); }
  }

  private async onTagsChanged(e: CustomEvent) {
    this.currentTags = e.detail.tags;
    this.requestUpdate();
    await this.persist();
  }

  private async onNotesChanged(e: CustomEvent) {
    this.currentNotes = e.detail.notes;
    this.requestUpdate();
    await this.persist();
  }

  private async onColorChangedFromForm(e: CustomEvent) {
    const c = e.detail.color as HighlightColor;
    if (this.currentId) {
      await changeHighlightColor(this.currentId, c);
      this.currentColor = c;
      this.requestUpdate();
    }
  }

  private async persist() {
    if (!this.currentId || !this.currentColor) return;
    // Done/outside click may reset the widget while the record is loading.
    const id = this.currentId;
    const patch = { color: this.currentColor, tags: [...this.currentTags], notes: this.currentNotes };
    const record = await loadHighlightById(id);
    if (!record) return;
    const updated = { ...record, ...patch, updatedAt: Date.now() };
    await window.electronAPI?.saveHighlight(updated);
  }

  render() {
    if (!this.visible) return html``;
    if (this.mode === 'expanded') {
      return html`<octo-edit-form
        .color=${this.currentColor}
        .tags=${this.currentTags}
        .notes=${this.currentNotes}
        .suggestions=${this.suggestions}
        .pulseColors=${this.pulseColors}
        @color-changed=${this.onColorChangedFromForm}
        @tags-changed=${this.onTagsChanged}
        @notes-changed=${this.onNotesChanged}
        @done-requested=${() => { this.hide(); this.reset(); }}
      ></octo-edit-form>`;
    }
    return html`
      <div class="octo-pill ${this.pulseColors ? 'pulse' : ''}"
           @pointerdown=${(e: PointerEvent) => { e.stopPropagation(); }}
           @mousedown=${(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); }}>
        ${(this.paletteOpen ? HIGHLIGHT_COLORS : HIGHLIGHT_COLORS.slice(0, 1)).map((c) => html`
          <button class="octo-swatch" style="background:${PALETTE[c].fill}" title=${c}
                  @click=${() => this.onSwatch(c)}></button>
        `)}
        ${this.paletteOpen ? html`
          <div class="octo-divider"></div>
          <button class="octo-add-note" @click=${this.onAddNote}>+ note</button>
        ` : html`
          <button class="octo-more" title="More options"
                  @click=${() => { this.paletteOpen = true; this.requestUpdate(); }}>⋯</button>
        `}
      </div>
    `;
  }
}

// Function to handle text selection
const handleTextSelection = async (event: MouseEvent) => {
  if (isDraggingHighlight) return;
  // Read the composed path before awaiting: it crosses both shadow roots.
  if (hostElement && event.composedPath().includes(hostElement)) return;
  if (event.button !== 0 && event.type !== 'mousedown') return;

  // Delay to ensure selection is registered
  await new Promise(resolve => setTimeout(resolve, 10));

  // Once a highlight exists (pill with a current id, or the expanded form),
  // the user has committed and we no longer drive visibility from the
  // document selection — clicking a swatch clears the selection as a side
  // effect of applying the highlight, and re-running this handler on the
  // same click would otherwise hide the widget before "+ note" is reachable.
  if (highlighterWidget.mode === 'expanded' || highlighterWidget.hasHighlight) return;

  const selection = window.getSelection();
  const selectedText = selection ? selection.toString() : '';

  if (selectedText.length > 0 && selection) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // No highlights inside highlights: selecting within one edits it.
    const existing = highlightIntersecting(range);
    if (existing) {
      selection.removeAllRanges();
      highlighterWidget.hide();
      suppressClickThisTask();
      void openEditPanel(existing.id, existing.rect);
      return;
    }

    highlighterWidget.updateWidgetPosition(rect);
    highlighterWidget.show();
  }
  else {
    // Hide the widget if no text is selected
    highlighterWidget.hide();
  }
}

const monitorTextSelection = () => {
  // Add mouseup event listener to monitor text selection
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('mousedown', handleTextSelection);
}

// IIFE, Auto-inject when loaded
// Instantiate the highlighter widget
const highlighterWidget = new HighlighterWidget();
(() => {
  // Handle text selection monitoring
  monitorTextSelection();
  // Inject palette styles into the host document
  injectGlobalStyles();
  // Inject the highlighter widget into shadow DOM
  shadowRoot.appendChild(highlighterWidget);

  // Click outside the widget host while it owns a highlight (pill after
  // applying, or the expanded form) → close + reset.
  document.addEventListener('mousedown', (e) => {
    const target = e.target as Node;
    if (
      hostElement &&
      !hostElement.contains(target) &&
      highlighterWidget.visible &&
      (highlighterWidget.mode === 'expanded' || highlighterWidget.hasHighlight)
    ) {
      highlighterWidget.reset();
      highlighterWidget.hide();
    }
  }, true);

  // Escape closes regardless of mode.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && highlighterWidget.visible) {
      highlighterWidget.reset();
      highlighterWidget.hide();
    }
  });
})();

// React to highlight updates broadcast by main (e.g. card-side edits that
// propagated back via syncHighlightFromCard). The id is shared across every
// rendered fragment, so we swap the class on each one.
window.electronAPI?.onHighlightUpdated?.((h) => {
  const fragments = Array.from(
    document.querySelectorAll(`[data-octobase-highlight-id="${h.id}"]`),
  ) as HTMLElement[];
  if (fragments.length === 0) {
    // Range-painted: refresh colour and note dot from the broadcast record.
    if (anchoredRecords.some((r) => r.id === h.id) && h.textAnchor) addAnchored(toOverlayItem(h));
    return;
  }
  // Element-painted: the note dot follows the record's note.
  if (h.notes?.trim()) notedFragmentIds.add(h.id); else notedFragmentIds.delete(h.id);
  overlay.reposition();
  for (const el of fragments) {
    let needsClassSwap = true;
    for (const c of HIGHLIGHT_COLORS) {
      if (c === h.color) {
        if (el.classList.contains(classNameFor(c))) needsClassSwap = false;
      } else {
        el.classList.remove(classNameFor(c));
      }
    }
    if (needsClassSwap) el.classList.add(classNameFor(h.color));
    if (typeof h.text === 'string') el.dataset.octobaseHighlightText = h.text;
  }
});

// Highlights that carry no Rangy range — made by the extension, a reader
// pane, or another device — are painted with the CSS Custom Highlight API,
// the same way the extension paints on a live page.
let anchoredRecords: OverlayHighlight[] = [];
/**
 * Highlights the page holds as text ranges rather than elements. The overlay
 * paints them as marker bands, hit-tests them back, and badges the ones
 * carrying a note — the Rangy-painted ones report their own rects through
 * `extraBadgeRects` so both kinds get the same marker.
 */
const overlay = createAnchoredOverlay({
  root: document.body,
  extraBadgeRects: () => {
    const byId = new Map<string, DOMRect[]>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-octobase-highlight-id]'))) {
      const id = el.dataset.octobaseHighlightId;
      if (!id || !notedFragmentIds.has(id)) continue;
      const list = byId.get(id) ?? [];
      list.push(...Array.from(el.getClientRects()));
      byId.set(id, list);
    }
    return [...byId].map(([id, rects]) => ({ id, rects }));
  },
});
/** Ids of Rangy-painted highlights that carry a note. */
const notedFragmentIds = new Set<string>();

function repaintAnchored() {
  overlay.set(anchoredRecords);
}

/** Add one text-anchored highlight to the painted set (no duplicates). */
function addAnchored(item: OverlayHighlight) {
  anchoredRecords = anchoredRecords.filter((r) => r.id !== item.id).concat(item);
  repaintAnchored();
}

/** A stored highlight as the overlay wants it. */
function toOverlayItem(r: Highlight): OverlayHighlight {
  return {
    id: r.id,
    color: r.color,
    anchor: r.textAnchor as TextAnchor,
    note: r.notes ?? '',
    text: r.text ?? '',
  };
}

// Re-apply persisted highlights for this URL once the page is settled.
async function reapplyOnLoad() {
  const url = window.location.href;
  const records = (await window.electronAPI?.loadHighlights(url)) ?? [];
  console.log(`[octobase-highlighter] reapplyOnLoad: ${records.length} records for ${url}`);
  anchoredRecords = [];
  notedFragmentIds.clear();
  for (const r of records) {
    if (r.notes?.trim()) notedFragmentIds.add(r.id);
    // No DOM range (or one this page can't resolve): paint from the text.
    if (!r.anchor?.serialized || !rangy.canDeserializeRange(r.anchor.serialized, document.body)) {
      if (r.textAnchor) anchoredRecords.push(toOverlayItem(r));
      else console.warn('[octobase-highlighter] highlight has no usable anchor', r.id);
      continue;
    }
    try {
      const range = rangy.deserializeRange(r.anchor.serialized, document.body);
      const sel = rangy.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const highlighter = rangy.createHighlighter();
      highlighter.addClassApplier(appliers[r.color]);
      highlighter.highlightSelection(classNameFor(r.color));
      sel.removeAllRanges();

      // Stamp re-applied fragments with the persisted id + text.
      const fragments = Array.from(
        document.querySelectorAll(`.${classNameFor(r.color)}:not([data-octobase-highlight-id])`),
      ) as HTMLElement[];
      if (fragments.length > 0) {
        stampHighlightGroup(fragments, r.text, () => r.id);
        applyContrastGuard(fragments);
      }
    } catch (err) {
      console.warn('[octobase-highlighter] failed to re-apply highlight', r.id, err);
      if (r.textAnchor) anchoredRecords.push(toOverlayItem(r));
    }
  }
  repaintAnchored();
}

// ── Click to edit ───────────────────────────────────────────────────────────
// A plain click on a saved highlight — element- or band-painted — opens its
// edit panel. Links inside a highlight stay links, and a drag-selection is
// left to the selection handler, which treats selecting inside a highlight
// as editing that highlight rather than nesting a new one.

/** Last fragment of an element-painted highlight, for anchoring the panel. */
function lastFragmentRect(id: string): DOMRect | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-octobase-highlight-id="${CSS.escape(id)}"]`);
  const last = els[els.length - 1];
  return last ? last.getBoundingClientRect() : null;
}

/** The saved highlight a selection overlaps, whichever way it was painted. */
function highlightIntersecting(range: Range): { id: string; rect: DOMRect } | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-octobase-highlight-id]'))) {
    const id = el.dataset.octobaseHighlightId;
    if (id && range.intersectsNode(el)) return { id, rect: lastFragmentRect(id) ?? el.getBoundingClientRect() };
  }
  const hit = overlay.intersecting(range);
  const rect = hit ? overlay.rectFor(hit.id) : null;
  return hit && rect ? { id: hit.id, rect } : null;
}

/** Set when a mouse-up already opened the panel, so its click doesn't repeat it. */
let suppressNextClick = false;
function suppressClickThisTask() {
  suppressNextClick = true;
  // The click, if any, is dispatched before timers run.
  setTimeout(() => { suppressNextClick = false; }, 0);
}

document.addEventListener('click', (e) => {
  if (suppressNextClick || isDraggingHighlight) return;
  const path = e.composedPath();
  if (hostElement && path.includes(hostElement)) return;
  if (editPanelEl && path.includes(editPanelEl)) return;
  if (path.some((n) => n instanceof HTMLAnchorElement && n.href)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  const fragment = (e.target as HTMLElement | null)?.closest?.('[data-octobase-highlight-id]') as HTMLElement | null;
  const id = fragment?.dataset.octobaseHighlightId ?? overlay.at(e.clientX, e.clientY)?.id;
  if (!id) return;
  const rect = fragment ? lastFragmentRect(id) : overlay.rectFor(id);
  if (rect) void openEditPanel(id, rect);
});

document.addEventListener('pointerdown', (downEvent) => {
  if (downEvent.button !== 0) return;
  if ((downEvent.target as HTMLElement | null)?.closest?.('[data-octobase-highlight-id]')) return;
  const hit = overlay.at(downEvent.clientX, downEvent.clientY);
  if (!hit || !hit.text) return;

  const startX = downEvent.clientX;
  const startY = downEvent.clientY;

  const cleanup = () => {
    clearTimeout(holdTimer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  const onMove = (moveEvent: PointerEvent) => {
    // Moving means the user is selecting text, not dragging the highlight.
    if (Math.abs(moveEvent.clientX - startX) > 5 || Math.abs(moveEvent.clientY - startY) > 5) cleanup();
  };
  const onUp = () => cleanup();
  const holdTimer = setTimeout(() => {
    cleanup();
    isDraggingHighlight = true;
    launchHighlightDrag(hit.text, hit.id, startX, startY);
  }, 250);

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
});

// Run after the page is fully loaded (incl. resources) plus a short settle
// delay so JS-driven content has a chance to render before we resolve the
// serialized Rangy anchors.
function scheduleReapply() {
  setTimeout(() => { reapplyOnLoad(); }, 500);
}
if (document.readyState === 'complete') {
  scheduleReapply();
} else {
  window.addEventListener('load', () => { scheduleReapply(); });
}

// A highlight deleted elsewhere — the extension, or the app — leaves the
// page: unwrap its fragments if it was element-painted, drop it from the
// overlay if it was band-painted. The pane's own deletes echo through here
// too, by which time there is nothing left to remove.
window.electronAPI?.onHighlightDeleted?.(({ id }) => {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-octobase-highlight-id="${CSS.escape(id)}"]`))) {
    while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
    el.remove();
  }
  notedFragmentIds.delete(id);
  if (anchoredRecords.some((r) => r.id === id)) {
    anchoredRecords = anchoredRecords.filter((r) => r.id !== id);
    repaintAnchored();
  } else {
    overlay.reposition();
  }
  if (editPanelTargetId === id) closeEditPanel();
});

// A highlight made elsewhere — the capture extension on this same page —
// lands here; paint it without waiting for a reload.
window.electronAPI?.onHighlightAdded?.((h) => {
  if (h.sourceUrl.split('#')[0] !== window.location.href.split('#')[0] || !h.textAnchor) return;
  if (document.querySelector(`[data-octobase-highlight-id="${CSS.escape(h.id)}"]`)) return;
  addAnchored(toOverlayItem(h));
});

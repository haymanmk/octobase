/**
 * Highlighter widget entry point for building standalone bundle.
 * Here we inject the custom web component into another website via shadow DOM.
 */
import {LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import 'rangy/lib/rangy-classapplier';
import 'rangy/lib/rangy-highlighter';
import 'rangy/lib/rangy-serializer';
import rangy from 'rangy';
import { HIGHLIGHT_COLORS, type HighlightColor, type Highlight } from '../../types/highlight';
import { classNameFor, PALETTE } from './colors';
import { getHighlightDragPayload, stampHighlightGroup } from './highlight-id';
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
      onHighlightDeleted: (callback: (data: { id: string }) => void) => void;
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


// === Hover-revealed menu button ===
// One reusable button shared across all highlight fragments. Repositioned
// each time the cursor enters a fragment, hidden after a short grace
// timeout so the cursor can travel onto the button without flicker.
let menuButton: HTMLButtonElement | null = null;
let menuButtonHideTimer: number | null = null;
let menuButtonTargetId: string | null = null;

function ensureMenuButton(): HTMLButtonElement {
  if (menuButton) return menuButton;
  const btn = document.createElement('button');
  btn.className = 'octo-hl-menubtn';
  btn.textContent = '⋯';
  btn.style.position = 'absolute';
  btn.style.display = 'none';
  btn.style.zIndex = '9998';
  btn.style.width = '22px';
  btn.style.height = '22px';
  btn.style.borderRadius = '50%';
  btn.style.border = '1px solid #ddd';
  btn.style.background = 'white';
  btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  btn.style.fontSize = '11px';
  btn.style.color = '#666';
  btn.style.cursor = 'pointer';
  btn.style.padding = '0';
  btn.style.lineHeight = '1';
  // Stop pointerdown so it doesn't trigger the hold-to-drag on the highlight.
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuButtonTargetId) openEditPanel(menuButtonTargetId, btn.getBoundingClientRect());
  });
  // Keep the button visible while the cursor is over it.
  btn.addEventListener('mouseenter', () => {
    if (menuButtonHideTimer) { clearTimeout(menuButtonHideTimer); menuButtonHideTimer = null; }
  });
  btn.addEventListener('mouseleave', scheduleMenuButtonHide);
  document.body.appendChild(btn);
  menuButton = btn;
  return btn;
}

function showMenuButton(target: HTMLElement) {
  const btn = ensureMenuButton();
  if (menuButtonHideTimer) { clearTimeout(menuButtonHideTimer); menuButtonHideTimer = null; }
  const rect = target.getBoundingClientRect();
  btn.style.top = `${rect.top + window.scrollY - 6}px`;
  btn.style.left = `${rect.right + window.scrollX - 12}px`;
  btn.style.display = 'inline-block';
  menuButtonTargetId = target.dataset.octobaseHighlightId ?? null;
}

function scheduleMenuButtonHide() {
  if (menuButtonHideTimer) clearTimeout(menuButtonHideTimer);
  menuButtonHideTimer = window.setTimeout(() => {
    if (menuButton) menuButton.style.display = 'none';
    menuButtonTargetId = null;
  }, 250);
}

// === Edit panel (opened from the menu button on a saved highlight) ===
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

  document.body.appendChild(form);
  editPanelEl = form;
}

function closeEditPanel(): void {
  if (editPanelEl && editPanelEl.parentNode) editPanelEl.parentNode.removeChild(editPanelEl);
  editPanelEl = null;
  editPanelTargetId = null;
  editPanelLocal = null;
}

async function persistEdit(): Promise<void> {
  if (!editPanelTargetId || !editPanelLocal) return;
  const record = await loadHighlightById(editPanelTargetId);
  if (!record) return;
  await window.electronAPI?.saveHighlight({
    ...record,
    color: editPanelLocal.color ?? record.color,
    tags: editPanelLocal.tags,
    notes: editPanelLocal.notes,
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
      for (const el of document.querySelectorAll(`.${classNameFor(record.color)}:not([data-octobase-highlight-id])`)) {
        const htmlEl = el as HTMLElement;
        htmlEl.dataset.octobaseHighlightId = record.id;
        htmlEl.dataset.octobaseHighlightText = record.text;
      }
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
  if (menuButton && menuButton.contains(e.target as Node)) return;
  closeEditPanel();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editPanelEl) closeEditPanel();
});

// Attaches hold-to-drag behavior to a single highlight fragment element.
function attachFragmentBehavior(htmlEl: HTMLElement) {
  htmlEl.addEventListener('mouseenter', () => showMenuButton(htmlEl));
  htmlEl.addEventListener('mouseleave', scheduleMenuButtonHide);
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
  }
  sel.removeAllRanges();

  const now = Date.now();
  await window.electronAPI?.saveHighlight({
    id, text, sourceUrl: window.location.href, color,
    tags: [], notes: '',
    anchor: { serialized },
    createdAt: now, updatedAt: now,
  });
  return id;
}

async function changeHighlightColor(id: string, color: HighlightColor): Promise<void> {
  const fragments = Array.from(document.querySelectorAll(`[data-octobase-highlight-id="${id}"]`)) as HTMLElement[];
  if (fragments.length === 0) return;
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
  static styles = css`
    :host {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: auto;
      isolation: isolate;
    }
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 10px; background: white; border-radius: 24px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12); border: 1px solid #eee;
      pointer-events: auto;
    }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.06); cursor: pointer; padding: 0;
    }
    .divider { width: 1px; height: 20px; background: #e5e5e5; margin: 0 2px; }
    .add-note {
      font-size: 11px; color: #666; cursor: pointer; user-select: none;
      background: transparent; border: none; padding: 4px;
    }
    .add-note:hover { color: #111; }
    .pulse .swatch { animation: pulse 0.6s ease 2; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
  `;

  // Plain class fields rather than @property/@state — Vite library mode parses
  // the entry file with Rollup's acorn parser, which does not yet recognise the
  // standard-decorator `accessor` keyword. Mutations call requestUpdate().
  visible: boolean = false;
  mode: 'pill' | 'expanded' = 'pill';
  private pulseColors = false;
  private currentId: string | null = null;
  private currentColor: HighlightColor | null = null;
  private currentTags: string[] = [];
  private currentNotes: string = '';
  private suggestions: string[] = [];

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
    this.requestUpdate();
  }

  hide() {
    this.visible = false;
    this.requestUpdate();
  }

  reset() {
    this.currentId = null;
    this.currentColor = null;
    this.currentTags = [];
    this.currentNotes = '';
    this.mode = 'pill';
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
      this.mode = 'expanded';
      this.requestUpdate();
    } else {
      await changeHighlightColor(this.currentId, color);
      this.currentColor = color;
      this.requestUpdate();
    }
  }

  private onAddNote() {
    if (this.currentId) { this.mode = 'expanded'; this.requestUpdate(); return; }
    this.pulseColors = true;
    this.requestUpdate();
    setTimeout(() => { this.pulseColors = false; this.requestUpdate(); }, 1300);
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
    const record = await loadHighlightById(this.currentId);
    if (!record) return;
    const updated = { ...record, color: this.currentColor, tags: this.currentTags, notes: this.currentNotes, updatedAt: Date.now() };
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
      ></octo-edit-form>`;
    }
    return html`
      <div class="pill ${this.pulseColors ? 'pulse' : ''}"
           @pointerdown=${(e: PointerEvent) => { e.stopPropagation(); }}
           @mousedown=${(e: MouseEvent) => { e.stopPropagation(); }}>
        ${HIGHLIGHT_COLORS.map((c) => html`
          <button class="swatch" style="background:${PALETTE[c].fill}" title=${c}
                  @click=${() => this.onSwatch(c)}></button>
        `)}
        <div class="divider"></div>
        <button class="add-note" @click=${this.onAddNote}>+ note</button>
      </div>
    `;
  }
}

// Function to handle text selection
const handleTextSelection = async (event: MouseEvent) => {
  if (isDraggingHighlight) return;
  if (event.button !== 0 && event.type !== 'mousedown') return;

  // Delay to ensure selection is registered
  await new Promise(resolve => setTimeout(resolve, 10));

  // Once the widget has expanded into the edit form, the user has committed
  // to a highlight and we no longer drive visibility from the document
  // selection — clicking a swatch clears the selection as a side effect of
  // applying the highlight, and re-running this handler on the same click
  // would otherwise hide the form.
  if (highlighterWidget.mode === 'expanded') return;

  const selection = window.getSelection();
  const selectedText = selection ? selection.toString() : '';

  if (selectedText.length > 0 && selection) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Update widget position
    highlighterWidget.updateWidgetPosition(rect);
    // Set widget visibility
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

  // Click outside the widget host while expanded → close + reset.
  document.addEventListener('mousedown', (e) => {
    const target = e.target as Node;
    if (
      hostElement &&
      !hostElement.contains(target) &&
      highlighterWidget.visible &&
      highlighterWidget.mode === 'expanded'
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

// Re-apply persisted highlights for this URL once the page is settled.
async function reapplyOnLoad() {
  const url = window.location.href;
  const records = (await window.electronAPI?.loadHighlights(url)) ?? [];
  console.log(`[octobase-highlighter] reapplyOnLoad: ${records.length} records for ${url}`);
  for (const r of records) {
    console.log(`[octobase-highlighter] re-applying ${r.id}`, {
      text: r.text,
      serialized: r.anchor.serialized,
    });
    try {
      if (!rangy.canDeserializeRange(r.anchor.serialized, document.body)) {
        console.warn('[octobase-highlighter] cannot deserialize range', r.id, r.anchor.serialized);
        continue;
      }
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
      }
    } catch (err) {
      console.warn('[octobase-highlighter] failed to re-apply highlight', r.id, err);
    }
  }
}

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

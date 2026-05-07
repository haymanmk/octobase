/**
 * Highlighter widget entry point for building standalone bundle.
 * Here we inject the custom web component into another website via shadow DOM.
 */
import {LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import 'rangy/lib/rangy-classapplier';
import 'rangy/lib/rangy-highlighter';
import rangy from 'rangy';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../types/highlight';
import { classNameFor } from './colors';
import { getHighlightDragPayload } from './highlight-id';
import { injectGlobalStyles } from './widget-styles';

// Declare the electron API
declare global {
  interface Window {
    electronAPI?: {
      sendTextSelection: (data: { text: string; action: string }) => void;
      sendDragText: (data: { text: string; sourceUrl: string; cursorX: number; cursorY: number; highlightId: string }) => void;
      sendDragPosition: (data: { x: number; y: number }) => void;
      sendDragEnd: (data: { x: number; y: number }) => void;
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
  visible: boolean = false;

  static styles = css`
    .base-style {
      background-color: #eeefed;
      box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
      color: black;
      padding: 10px;
      border-radius: 5px;
      font-family: Arial, sans-serif;
    }
  `;

  // Update HighlighterWidget position based on selection rect
  updateWidgetPosition = (rect: DOMRect) => {
    highlighterWidget!.style.position = 'absolute';
    highlighterWidget!.style.top = `${rect.bottom + window.scrollY + 10}px`;
    highlighterWidget!.style.left = `${rect.left + window.scrollX}px`;
    highlighterWidget!.style.zIndex = '9999';
  }

  show() {
    this.visible = true;
    this.requestUpdate();
  }

  hide() {
    this.visible = false;
    this.requestUpdate();
  }

  handleHighlightClick(color: HighlightColor) {
    const highlighter = rangy.createHighlighter();
    highlighter.addClassApplier(appliers[color]);
    highlighter.highlightSelection(classNameFor(color));
    rangy.getSelection().removeAllRanges();
  }

  render() {
    return this.visible
     ? html`<div class="base-style">
       ${HIGHLIGHT_COLORS.map(c => html`<button @click=${() => this.handleHighlightClick(c)}>${c}</button>`)}
     </div>`
     : html``;
  }
}

// Function to handle text selection
const handleTextSelection = async (event: MouseEvent) => {
  if (isDraggingHighlight) return;
  if (event.button !== 0 && event.type !== 'mousedown') return;

  // Delay to ensure selection is registered
  await new Promise(resolve => setTimeout(resolve, 10));

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
})();

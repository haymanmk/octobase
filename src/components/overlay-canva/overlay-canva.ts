/**
 * Overlay Canva Component
 * @brief This component provides a transparent overlay canvas for drag-and-drop
 *        interactions over the main content area.
 */
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

// Declare the electron API
declare global {
  interface Window {
    overlayAPI?: {
      onDragText: (callback: (data: { text: string; sourceUrl: string; cursorX: number; cursorY: number; highlightId: string }) => void) => void;
      onDragPosition: (callback: (data: { x: number; y: number }) => void) => void;
      onDragEnd: (callback: () => void) => void;
      sendDrop: (data: { text: string; sourceUrl: string; x: number; y: number; highlightId: string }) => void;
    };
  }
}

// A component to show drag-and-drop text proxy
@customElement('drag-text-proxy')
export class DragTextProxy extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      background-color: rgba(255, 255, 255, 0.92);
      border: 1px solid #e0e0e0;
      padding: 12px;
      border-radius: 8px;
      pointer-events: auto;
      cursor: grabbing;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      max-width: 220px;
      overflow: hidden;
      transform: translate(-50%, -50%);
    }
    .card-text {
      font-size: 12px;
      line-height: 1.4;
      color: #333;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }
    .card-source {
      font-size: 10px;
      color: #888;
      margin-top: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  
  declare text: string;
  declare sourceUrl: string;
  declare x: number;
  declare y: number;

  static properties = {
    text: { type: String },
    sourceUrl: { type: String },
    x: { type: Number },
    y: { type: Number },
  };
  
  constructor() {
    super();
    this.text = '';
    this.sourceUrl = '';
    this.x = 0;
    this.y = 0;
  }

  updated(changedProperties: Map<string, any>) {
    console.log('DragTextProxy updated:', changedProperties);
    if (changedProperties.has('x') || changedProperties.has('y')) {
      this.style.left = `${this.x}px`;
      this.style.top = `${this.y}px`;
      console.log(`DragTextProxy moved to (${this.x}, ${this.y})`);
    }
  }

  render() {
    let hostname = '';
    try {
      hostname = new URL(this.sourceUrl).hostname;
    } catch {
      hostname = this.sourceUrl;
    }
    return html`
      <div class="card-text">${this.text || 'placeholder'}</div>
      ${hostname ? html`<div class="card-source">${hostname}</div>` : ''}
    `;
  }
}

// IIFE, render a component with selected text for drag-and-drop
(() => {
  // Listen for drag-drop-text-selection event
  const startListening = () => {
    window.overlayAPI?.onDragText((data: { text: string; sourceUrl: string; cursorX: number; cursorY: number; highlightId: string }) => {
      console.log('OverlayCanva received drag text:', data);
      // Create and append the drag-text-proxy component
      const overlayCanva = document.querySelector('#overlay-canva-app');
      
      if (overlayCanva) {
        // Show grabbing cursor on the overlay during drag
        (overlayCanva as HTMLElement).style.cursor = 'grabbing';

        const dragProxy = document.createElement('drag-text-proxy') as DragTextProxy;
        console.log('Created drag-text-proxy:', dragProxy);
        dragProxy.text = data.text;
        dragProxy.sourceUrl = data.sourceUrl || '';
        overlayCanva.appendChild(dragProxy);

        // Initialize position centered under the cursor
        let lastX = data.cursorX || 0;
        let lastY = data.cursorY || 0;
        dragProxy.x = lastX;
        dragProxy.y = lastY;

        // Update position from IPC (relayed from the right view)
        window.overlayAPI?.onDragPosition((pos: { x: number; y: number }) => {
          lastX = pos.x;
          lastY = pos.y;
          dragProxy.x = pos.x;
          dragProxy.y = pos.y;
        });

        // On drag end (relayed from the right view), send drop and clean up
        window.overlayAPI?.onDragEnd(() => {
          window.overlayAPI?.sendDrop({
            text: data.text,
            sourceUrl: data.sourceUrl || '',
            x: lastX,
            y: lastY,
            highlightId: data.highlightId,
          });
          (overlayCanva as HTMLElement).style.cursor = '';
          if (dragProxy.parentNode === overlayCanva) {
            overlayCanva.removeChild(dragProxy);
          }
        });
      }
    });
  };

  // Wait for the DOM to be fully loaded
  document.addEventListener('DOMContentLoaded', () => {
    console.log('OverlayCanva DOM fully loaded');
    console.log('window.overlayAPI', window.overlayAPI);
    startListening();
  });
})();
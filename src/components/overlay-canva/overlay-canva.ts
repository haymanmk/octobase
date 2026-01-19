/**
 * Overlay Canva Component
 * @brief This component provides a transparent overlay canvas for drag-and-drop
 *        interactions over the main content area.
 */
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('overlay-canva')
export class OverlayCanva extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none; /* Allow clicks to pass through */
      background-color: rgba(0, 0, 0, 0); /* Fully transparent */
      z-index: 998; /* Below other interactive elements */
    }
  `;

  render() {
    return html`<slot></slot>`;
  }
}

// A component to show drag-and-drop text proxy
@customElement('drag-text-proxy')
export class DragTextProxy extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      background-color: rgba(255, 255, 0, 0.8);
      border: 1px solid black;
      padding: 5px;
      border-radius: 3px;
      pointer-events: none; /* Allow clicks to pass through */
      z-index: 9999; /* Above all other elements */
      font-family: Arial, sans-serif;
    }
  `;
  
  static properties = {
    text: { type: String },
    x: { type: Number },
    y: { type: Number },
  };
  text: string = '';
  x: number = 0;
  y: number = 0;

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('x') || changedProperties.has('y')) {
      this.style.left = `${this.x}px`;
      this.style.top = `${this.y}px`;
    }
  }

  render() {
    return html`${this.text}`;
  }
}

// IIFE, render a component with selected text for drag-and-drop
(() => {
  const overlayCanva = new OverlayCanva();
  document.body.appendChild(overlayCanva);

  const dragTextProxy = new DragTextProxy();
  overlayCanva.appendChild(dragTextProxy);
})();
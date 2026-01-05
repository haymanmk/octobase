/**
 * Highlighter widget entry point for building standalone bundle.
 * Here we inject the custom web component into another website via shadow DOM.
 */
import {LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import 'rangy/lib/rangy-classapplier';
import 'rangy/lib/rangy-highlighter';
import rangy from 'rangy';

// Declare the electron API
declare global {
  interface Window {
    // rangy: {
    //   createHighlighter: (
    //         doc?: Document | Window | HTMLIFrameElement,
    //         type?: "textContent" | "textRange",
    //   ): RangyHighlighter;
    // };
    electronAPI?: {
      sendTextSelection: (data: { text: string; action: string }) => void;
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

  handleHighlightClick() {
    // Wrap the selected text with highlighter component
    const highlighter =rangy.createHighlighter();
    console.log(highlighter);
  }

  render() {
    return this.visible
     ? html`<div class="base-style">
     <p>Highlighter Widget Loaded</p>
     <button @click=${this.handleHighlightClick}>Highlight</button>
     </div>`
     : html``;
  }
}

// const createHighlighter = () => {
//   const selection = window.getSelection();
//   if (selection && selection.rangeCount > 0) {
//     const range = selection.getRangeAt(0);
//     const highlighter = new HighlighterComponent();
//     range.surroundContents(highlighter);
//     // Clear selection after highlighting
//     selection.removeAllRanges();
//   }
// }

// Function to handle text selection
const handleTextSelection = async () => {
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

    // Handle the selected text and its position
    console.log('Selected Text:', selectedText);
    console.log('Selection Position:', rect);
  }
  else {
    // Hide the widget if no text is selected
    highlighterWidget.hide();
    console.log('No text selected.');
  }
}

const monitorTextSelection = () => {
  // Add mouseup event listener to monitor text selection
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('mousedown', handleTextSelection);
}

const addStylesToBody = () => {
  const style = document.createElement('style');
  style.innerHTML = `
    highlighter-component {
      background-color: yellow;
      color: black;
      border-radius: 5px;
    }
  `;
  document.body.appendChild(style);
}

// IIFE, Auto-inject when loaded
// Instantiate the highlighter widget
const highlighterWidget = new HighlighterWidget();
(() => {
  // Handle text selection monitoring
  monitorTextSelection();
  // Add necessary styles to the body
  addStylesToBody();
  // Inject the highlighter widget into shadow DOM
  shadowRoot.appendChild(highlighterWidget);
})();
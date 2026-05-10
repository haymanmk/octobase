import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("octo-undo-toast")
export class UndoToast extends LitElement {
  static styles = css`
    :host {
      position: fixed; bottom: 24px; left: 50%;
      transform: translateX(-50%); z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .toast {
      display: inline-flex; gap: 12px; align-items: center;
      padding: 10px 14px; background: #1f2937; color: white;
      border-radius: 8px; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    }
    button {
      background: transparent; border: none; color: white;
      text-decoration: underline; cursor: pointer; font: inherit;
      opacity: 0.9; padding: 0;
    }
    button:hover { opacity: 1; }
  `;

  @property({ type: String }) accessor message: string = "Highlight deleted";

  private onUndo() {
    this.dispatchEvent(new CustomEvent("undo-clicked"));
  }

  render() {
    return html`<div class="toast"><span>${this.message}</span><button @click=${this.onUndo}>Undo</button></div>`;
  }
}

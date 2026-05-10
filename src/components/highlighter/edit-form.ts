import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

import { HIGHLIGHT_COLORS, type HighlightColor } from "../../types/highlight";
import { PALETTE } from "./colors";
import "./tag-input";

@customElement("octo-edit-form")
export class EditForm extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      border: 1px solid #eee;
      padding: 14px;
      min-width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .row { display: flex; gap: 8px; align-items: center; }
    .label {
      font-size: 10px; color: #888; margin: 0 0 6px 0;
      letter-spacing: 0.5px; text-transform: uppercase;
    }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .swatch {
      width: 22px; height: 22px; border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.06); cursor: pointer; padding: 0;
    }
    .swatch.active { border: 2px solid #333; }
    .delete {
      background: transparent; border: none; cursor: pointer;
      color: #888; font-size: 14px; padding: 0 4px;
    }
    .delete:hover { color: #ef4444; }
    textarea {
      width: 100%; min-height: 60px;
      border: 1px solid #e5e5e5; border-radius: 6px;
      padding: 6px; font-size: 12px; resize: vertical;
      box-sizing: border-box; font-family: inherit;
    }
    .colors { display: flex; gap: 8px; margin-bottom: 12px; }
    .pulse { animation: pulse 0.6s ease 2; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
  `;

  @property({ type: String }) accessor color: HighlightColor | null = null;
  @property({ type: Array }) accessor tags: string[] = [];
  @property({ type: String }) accessor notes: string = "";
  @property({ type: Array }) accessor suggestions: string[] = [];
  @property({ type: Boolean }) accessor showDelete: boolean = false;
  @property({ type: Boolean }) accessor pulseColors: boolean = false;

  private onColorClick(c: HighlightColor) {
    this.color = c;
    this.pulseColors = false;
    this.dispatchEvent(new CustomEvent("color-changed", { detail: { color: c } }));
  }

  private onTagsChanged(e: CustomEvent) {
    this.tags = e.detail.tags;
    this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
  }

  private onNotesBlur(e: FocusEvent) {
    const v = (e.target as HTMLTextAreaElement).value;
    if (v !== this.notes) {
      this.notes = v;
      this.dispatchEvent(new CustomEvent("notes-changed", { detail: { notes: v } }));
    }
  }

  private onDelete() {
    this.dispatchEvent(new CustomEvent("delete-requested"));
  }

  render() {
    return html`
      <div class="header">
        <p class="label">Color</p>
        ${this.showDelete ? html`<button class="delete" title="Delete highlight" @click=${this.onDelete}>🗑</button>` : ""}
      </div>
      <div class="colors ${this.pulseColors ? "pulse" : ""}">
        ${HIGHLIGHT_COLORS.map((c) => html`
          <button
            class="swatch ${this.color === c ? "active" : ""}"
            style="background:${PALETTE[c].fill}"
            title=${c}
            @click=${() => this.onColorClick(c)}
          ></button>
        `)}
      </div>
      <p class="label">Tags</p>
      <octo-tag-input
        .tags=${this.tags}
        .suggestions=${this.suggestions}
        @tags-changed=${this.onTagsChanged}
        style="margin-bottom: 12px"
      ></octo-tag-input>
      <p class="label">Notes</p>
      <textarea
        .value=${this.notes}
        placeholder="Notes…"
        @blur=${this.onNotesBlur}
      ></textarea>
    `;
  }
}

import { LitElement, html, css, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";

import { HIGHLIGHT_COLORS, type HighlightColor } from "../../types/highlight";
import { PALETTE } from "./colors";
import { pillCss, popoverCss } from "./toolbar-ui";
import "./tag-input";

/**
 * The shared highlight/clip edit form (color · tags · note · Delete/Done).
 * Styling comes from the same pill/popover recipe the readers use
 * (toolbar-ui.ts), so every surface renders the one 2026-07 design — never
 * fork the look here.
 */
@customElement("octo-edit-form")
export class EditForm extends LitElement {
  static styles = [
    unsafeCSS(pillCss()),
    unsafeCSS(popoverCss()),
    css`
      :host { display: inline-block; }
      .octo-pop-row.pulse .octo-swatch { animation: octo-swatch-pulse 0.6s ease 2; }
      .octo-pop-foot { margin-top: 2px; }
      /* Delete-less forms (fresh widget highlight, clip) keep Done right. */
      .octo-pop-foot .octo-pop-primary { margin-left: auto; }
    `,
  ];

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

  private onDone() {
    this.dispatchEvent(new CustomEvent("done-requested"));
  }

  render() {
    return html`
      <div class="octo-pop">
        <div class="octo-pop-row ${this.pulseColors ? "pulse" : ""}">
          ${HIGHLIGHT_COLORS.map((c) => html`
            <button
              class="octo-swatch ${this.color === c ? "current" : ""}"
              style="background:${PALETTE[c].fill}"
              title=${c}
              @click=${() => this.onColorClick(c)}
            ></button>
          `)}
        </div>
        <octo-tag-input
          .tags=${this.tags}
          .suggestions=${this.suggestions}
          @tags-changed=${this.onTagsChanged}
        ></octo-tag-input>
        <textarea
          class="octo-pop-input"
          rows="2"
          .value=${this.notes}
          placeholder="Add a note…"
          @blur=${this.onNotesBlur}
        ></textarea>
        <div class="octo-pop-foot">
          ${this.showDelete
            ? html`<button class="octo-pop-delete" title="Delete highlight" @click=${this.onDelete}>Delete</button>`
            : ""}
          <button class="octo-pop-primary" @click=${this.onDone}>Done</button>
        </div>
      </div>
    `;
  }
}

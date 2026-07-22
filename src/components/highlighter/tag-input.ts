import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

@customElement("octo-tag-input")
export class TagInput extends LitElement {
  static styles = css`
    :host { display: block; font-family: inherit; }
    .wrap {
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 6px 7px;
      background: #fff; border: 1px solid #e3e3e3; border-radius: 8px;
      min-height: 24px; align-items: center;
    }
    .wrap:focus-within { border-color: #4f7dc9; }
    .chip {
      font-size: 11px; padding: 2px 8px;
      background: rgba(79, 125, 201, 0.16); color: #212123; border-radius: 999px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .chip-x { cursor: pointer; opacity: 0.5; }
    .chip-x:hover { opacity: 1; }
    input {
      border: none; outline: none; background: transparent;
      font: 400 12.5px inherit; color: #212123; min-width: 80px; flex: 1;
      font-family: inherit;
    }
    input::placeholder { color: #8e8e91; }
    .dropdown {
      position: absolute; background: #fff; border: 1px solid #e3e3e3;
      border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.18);
      max-height: 160px; overflow-y: auto; min-width: 140px;
      z-index: 10000;
    }
    .suggest {
      padding: 4px 9px; font-size: 12.5px; cursor: pointer; color: #212123;
    }
    .suggest.active { background: rgba(79, 125, 201, 0.16); }
  `;

  @property({ type: Array }) accessor tags: string[] = [];
  @property({ type: Array }) accessor suggestions: string[] = [];

  @state() private accessor input = "";
  @state() private accessor activeIndex = -1;

  private get filteredSuggestions(): string[] {
    const q = this.input.trim().toLowerCase();
    if (!q) return [];
    return this.suggestions
      .filter((s) => s.includes(q) && !this.tags.includes(s))
      .slice(0, 6);
  }

  private commit(value: string) {
    const v = value.trim().toLowerCase();
    if (!v) return;
    if (!this.tags.includes(v)) {
      this.tags = [...this.tags, v];
      this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
    }
    this.input = "";
    this.activeIndex = -1;
  }

  private removeTag(t: string) {
    this.tags = this.tags.filter((x) => x !== t);
    this.dispatchEvent(new CustomEvent("tags-changed", { detail: { tags: this.tags } }));
  }

  private onKeyDown(e: KeyboardEvent) {
    const sugg = this.filteredSuggestions;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const pick = this.activeIndex >= 0 && sugg[this.activeIndex] ? sugg[this.activeIndex] : this.input;
      this.commit(pick);
    } else if (e.key === "Backspace" && this.input === "" && this.tags.length > 0) {
      this.removeTag(this.tags[this.tags.length - 1]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = Math.min(this.activeIndex + 1, sugg.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = Math.max(this.activeIndex - 1, -1);
    } else if (e.key === "Tab" && this.activeIndex >= 0 && sugg[this.activeIndex]) {
      e.preventDefault();
      this.commit(sugg[this.activeIndex]);
    } else if (e.key === "Escape") {
      if (this.activeIndex >= 0 || this.input) {
        e.stopPropagation();
        this.input = "";
        this.activeIndex = -1;
      }
    }
  }

  private onInput(e: Event) {
    this.input = (e.target as HTMLInputElement).value;
    this.activeIndex = -1;
  }

  private onBlur() {
    if (this.input.trim()) this.commit(this.input);
  }

  render() {
    const sugg = this.filteredSuggestions;
    return html`
      <div class="wrap">
        ${this.tags.map(
          (t) => html`<span class="chip">${t}<span class="chip-x" @click=${() => this.removeTag(t)}>×</span></span>`
        )}
        <input
          .value=${this.input}
          @input=${this.onInput}
          @keydown=${this.onKeyDown}
          @blur=${this.onBlur}
          placeholder="${this.tags.length ? "" : "+ tag…"}"
        />
        ${sugg.length > 0 ? html`
          <div class="dropdown">
            ${sugg.map(
              (s, i) => html`<div
                class="suggest ${i === this.activeIndex ? "active" : ""}"
                @mousedown=${(e: MouseEvent) => { e.preventDefault(); this.commit(s); }}
              >${s}</div>`
            )}
          </div>
        ` : ""}
      </div>
    `;
  }
}

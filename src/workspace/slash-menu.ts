/**
 * Notion-style slash commands for the card editor: typing "/" opens a small
 * popover at the caret (filter as you type, ↑↓ to move, ↵ to insert, Esc to
 * dismiss). Items and matching live in slash-items.ts; this file owns the
 * TipTap Suggestion wiring, the DOM popup, and what each item inserts.
 */
import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { filterSlashItems, type SlashItem } from "./slash-items.ts";

/** Run one item. `range` covers the "/query" text, which every action removes. */
function runItem(id: string, editor: Editor, range: Range): void {
  const chain = () => editor.chain().focus().deleteRange(range);
  /** Insert `text` and leave `placeholder` (its last occurrence) selected, so
   *  typing immediately replaces it. Inserted as a text node — a plain string
   *  would go through tiptap-markdown's parser, which mangles $ delimiters. */
  const insertWithPlaceholder = (text: string, placeholder: string) => {
    chain().insertContent({ type: "text", text }).run();
    const at = range.from + text.lastIndexOf(placeholder);
    editor.commands.setTextSelection({ from: at, to: at + placeholder.length });
  };
  switch (id) {
    case "h1": chain().setNode("heading", { level: 1 }).run(); break;
    case "h2": chain().setNode("heading", { level: 2 }).run(); break;
    case "h3": chain().setNode("heading", { level: 3 }).run(); break;
    case "bullet": chain().toggleBulletList().run(); break;
    case "numbered": chain().toggleOrderedList().run(); break;
    case "task": chain().toggleTaskList().run(); break;
    case "quote": chain().toggleBlockquote().run(); break;
    case "code": chain().toggleCodeBlock().run(); break;
    case "divider": chain().setHorizontalRule().run(); break;
    case "math-inline": insertWithPlaceholder("$x$", "x"); break;
    case "math-block": insertWithPlaceholder("$$x$$", "x"); break;
    case "embed": insertWithPlaceholder("![[card]]", "card"); break;
  }
}

/** The caret-anchored popup. Plain DOM (like toolbar-ui) — no portal needed. */
class SlashPopup {
  private el: HTMLDivElement;
  private items: SlashItem[] = [];
  private sel = 0;
  private command: (item: SlashItem) => void = () => {};

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "ws-slash";
    // Inside .ws-root so the --ws-* theme variables resolve (position: fixed
    // still positions against the viewport).
    (document.querySelector(".ws-root") ?? document.body).appendChild(this.el);
  }

  update(props: SuggestionProps<SlashItem>): void {
    this.items = props.items;
    this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
    this.command = (item) => props.command(item);
    const rect = props.clientRect?.();
    if (rect) {
      const width = 250;
      const x = Math.min(rect.left, window.innerWidth - width - 8);
      const below = rect.bottom + 6;
      const height = Math.min(this.items.length, 8) * 30 + 12;
      const y = below + height > window.innerHeight - 8 ? rect.top - height - 6 : below;
      this.el.style.left = `${Math.max(8, x)}px`;
      this.el.style.top = `${Math.max(8, y)}px`;
    }
    this.render();
  }

  move(dir: 1 | -1): void {
    if (this.items.length === 0) return;
    this.sel = (this.sel + dir + this.items.length) % this.items.length;
    this.render();
  }

  pick(): boolean {
    const item = this.items[this.sel];
    if (item) this.command(item);
    return !!item;
  }

  private render(): void {
    this.el.style.display = this.items.length ? "block" : "none";
    this.el.innerHTML = "";
    this.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = `ws-slash-item${i === this.sel ? " sel" : ""}`;
      const ico = document.createElement("span");
      ico.className = "ws-slash-ico";
      ico.textContent = it.icon;
      const label = document.createElement("span");
      label.textContent = it.label;
      const hint = document.createElement("span");
      hint.className = "ws-slash-hint";
      hint.textContent = it.hint;
      row.append(ico, label, hint);
      // mousedown, not click: keep the editor from losing focus first.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.command(it);
      });
      row.addEventListener("mouseenter", () => { this.sel = i; this.render(); });
      this.el.appendChild(row);
    });
  }

  destroy(): void {
    this.el.remove();
  }
}

export const SlashMenu = Extension.create({
  name: "slashMenu",

  addProseMirrorPlugins() {
    let popup: SlashPopup | null = null;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props: item }) => runItem(item.id, editor, range),
        render: () => ({
          onStart: (props) => {
            popup = new SlashPopup();
            popup.update(props);
          },
          onUpdate: (props) => popup?.update(props),
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (!popup) return false;
            if (props.event.key === "ArrowDown") { popup.move(1); return true; }
            if (props.event.key === "ArrowUp") { popup.move(-1); return true; }
            if (props.event.key === "Enter") return popup.pick();
            if (props.event.key === "Escape") return false; // let Suggestion close
            return false;
          },
          onExit: () => {
            popup?.destroy();
            popup = null;
          },
        }),
      }),
    ];
  },
});

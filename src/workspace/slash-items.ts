/**
 * The slash-menu catalog and its filter — pure data/functions so tests cover
 * matching without an editor. Execution lives in slash-menu.ts.
 */

export interface SlashItem {
  id: string;
  label: string;
  icon: string;
  /** Shown right-aligned in the menu (markdown shortcut or syntax). */
  hint: string;
  /** Extra names the filter matches besides the label. */
  aliases: string[];
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", icon: "H₁", hint: "#", aliases: ["h1", "title"] },
  { id: "h2", label: "Heading 2", icon: "H₂", hint: "##", aliases: ["h2"] },
  { id: "h3", label: "Heading 3", icon: "H₃", hint: "###", aliases: ["h3"] },
  { id: "bullet", label: "Bullet list", icon: "•", hint: "-", aliases: ["ul", "unordered"] },
  { id: "numbered", label: "Numbered list", icon: "1.", hint: "1.", aliases: ["ol", "ordered"] },
  { id: "task", label: "Task list", icon: "☑", hint: "[ ]", aliases: ["todo", "checkbox"] },
  { id: "quote", label: "Quote", icon: "❝", hint: ">", aliases: ["blockquote"] },
  { id: "code", label: "Code block", icon: "‹›", hint: "```", aliases: ["codeblock", "snippet"] },
  { id: "divider", label: "Divider", icon: "―", hint: "---", aliases: ["hr", "rule", "separator"] },
  { id: "math-inline", label: "Inline math", icon: "∑", hint: "$x$", aliases: ["latex", "katex", "formula"] },
  { id: "math-block", label: "Math block", icon: "∬", hint: "$$ $$", aliases: ["latex block", "katex", "equation", "display math"] },
  { id: "embed", label: "Embed card", icon: "⊞", hint: "![[…]]", aliases: ["card", "transclude", "include"] },
];

/** Case-insensitive prefix-then-substring match over label + aliases. */
export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const names = (it: SlashItem) => [it.label, ...it.aliases].map((s) => s.toLowerCase());
  const starts = items.filter((it) => names(it).some((n) => n.startsWith(q)));
  const contains = items.filter(
    (it) => !starts.includes(it) && names(it).some((n) => n.includes(q)),
  );
  return [...starts, ...contains];
}

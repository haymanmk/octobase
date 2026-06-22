// [[Card Title]] wikilink parsing. Titles are matched case-insensitively and
// trimmed. An optional alias form [[Title|shown text]] is supported.

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface ParsedWikilink {
  /** The target title, trimmed. */
  target: string;
  /** What to display (alias if present, else target). */
  label: string;
  /** Index in the source string of the opening `[[`. */
  index: number;
  /** Full matched text including brackets. */
  raw: string;
}

export function parseWikilinks(body: string): ParsedWikilink[] {
  const out: ParsedWikilink[] = [];
  if (!body) return out;
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({
      target,
      label: (m[2] ?? m[1]).trim(),
      index: m.index ?? 0,
      raw: m[0],
    });
  }
  return out;
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

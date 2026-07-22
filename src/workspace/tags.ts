/**
 * Pure tag-list helpers shared by the canvas card's tag editor. Kept free of
 * React/DOM so the add/remove/normalize rules can be unit-tested directly.
 *
 * Tags are stored trimmed and lower-cased (matching the store's convention in
 * getAllTags/getCardsByTag), so the same tag typed with different casing or
 * surrounding whitespace collapses to one.
 */

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Append a normalized tag, ignoring blanks and duplicates. */
export function addTag(tags: string[], raw: string): string[] {
  const t = normalizeTag(raw);
  if (!t || tags.includes(t)) return tags;
  return [...tags, t];
}

export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

/**
 * Autocomplete candidates for the current input: substring matches from the
 * workspace's known tags, excluding ones already applied, capped for the
 * dropdown. Empty input yields nothing (no suggestions until the user types).
 */
export function filterSuggestions(
  all: string[],
  input: string,
  applied: string[],
  limit = 6,
): string[] {
  const q = normalizeTag(input);
  if (!q) return [];
  return all.filter((s) => s.includes(q) && !applied.includes(s)).slice(0, limit);
}

/** Order-insensitive equality, for detecting whether a draft changed. */
export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

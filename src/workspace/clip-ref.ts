/**
 * `clip:<file>` — the pseudo-scheme card notes use to reference images stored
 * in the app's clips directory (same convention family as `pdf:<cardId>` and
 * `wikilink:`). Markdown stays clean and app-agnostic (`![](clip:a1b2.png)`);
 * renderers resolve the ref to the octobase-clip:// protocol URL at display
 * time. Kept dependency-free so tests can exercise it in plain node.
 */

const CLIP_SCHEME = "clip:";
/** Must match the protocol registered in src/electron/main.js. */
const CLIP_PROTOCOL_BASE = "octobase-clip://c/";

/** Markdown/image-node src for a clip file. */
export function clipRef(file: string): string {
  return `${CLIP_SCHEME}${file}`;
}

/** The clip file name inside a `clip:` ref, or null for any other src. */
export function parseClipRef(src: string): string | null {
  if (!src.startsWith(CLIP_SCHEME)) return null;
  const file = src.slice(CLIP_SCHEME.length).trim();
  // A bare file name only — no paths, no traversal.
  return /^[\w.-]+$/.test(file) ? file : null;
}

/** Resolve a `clip:` ref to its displayable URL; other srcs pass through. */
export function resolveClipSrc(src: string): string {
  const file = parseClipRef(src);
  return file ? `${CLIP_PROTOCOL_BASE}${file}` : src;
}

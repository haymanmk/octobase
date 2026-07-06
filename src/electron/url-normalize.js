/**
 * Turn address-bar input into a loadable URL: full URLs pass through, bare
 * domains get https://, anything else becomes a search query. Returns null
 * for empty input.
 */
export function normalizeAddress(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  // Domain-ish: no spaces and either a dot or a host:port.
  if (!/\s/.test(text) && (text.includes('.') || /^[\w-]+:\d+/.test(text))) {
    return `https://${text}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

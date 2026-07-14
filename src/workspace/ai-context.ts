import type { Card } from "../lib/model/types.ts";

/**
 * Ceiling for the card context embedded in the system prompt, in characters
 * (~60k tokens) — generous for current models while keeping requests sane.
 */
export const CONTEXT_CHAR_LIMIT = 240_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The card content the model should read, per kind. */
function cardContent(card: Card, fullText: string | null): string {
  switch (card.kind) {
    case "pdf":
      return (
        fullText ??
        `(The PDF's text could not be extracted — it may be a scanned document. Only the title is known.)`
      );
    case "highlight":
      return [
        `Highlighted passage: "${card.title}"`,
        card.body ? `Reader's note: ${card.body}` : "",
        `Source: ${hostOf(card.sourceUrl)} (${card.sourceUrl})`,
      ]
        .filter(Boolean)
        .join("\n");
    case "article":
      return `${card.body}\n\nSource: ${hostOf(card.sourceUrl)}`;
    case "image":
      return [
        "(This card is a clipped image; its pixels are not included.)",
        card.body ? `Caption/notes: ${card.body}` : "",
        `Source: ${hostOf(card.sourceUrl)}`,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return card.body;
  }
}

/**
 * System prompt for the ask-about-this-card chat: the card's content plus
 * grounding instructions, truncated with a visible marker when oversized.
 */
export function buildCardContext(
  card: Card,
  fullText: string | null,
): { system: string; truncated: boolean } {
  let content = cardContent(card, fullText);
  const truncated = content.length > CONTEXT_CHAR_LIMIT;
  if (truncated) {
    content = content.slice(0, CONTEXT_CHAR_LIMIT) + "\n\n[context truncated]";
  }
  const system = [
    "You are octobase's reading assistant. Answer questions about the card below,",
    "grounded in its content. When the content carries page markers, cite the relevant pages inline like [page N].",
    "If the answer is not in the content, say so.",
    "",
    `Card title: ${card.title}`,
    `Card kind: ${card.kind}`,
    "",
    "--- card content ---",
    content,
  ].join("\n");
  return { system, truncated };
}

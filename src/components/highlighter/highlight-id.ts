interface HighlightIdElement {
  dataset: Record<string, string | undefined>;
  textContent: string | null;
}

export function createHighlightId(): string {
  return `hl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getOrCreateHighlightId(
  element: HighlightIdElement,
  generateId: () => string = createHighlightId,
): string {
  if (element.dataset.octobaseHighlightId) {
    return element.dataset.octobaseHighlightId;
  }

  const highlightId = generateId();
  element.dataset.octobaseHighlightId = highlightId;
  return highlightId;
}

export function stampHighlightGroup(
  elements: HighlightIdElement[],
  text: string,
  generateId: () => string = createHighlightId,
): string {
  const highlightId = generateId();

  for (const element of elements) {
    element.dataset.octobaseHighlightId = highlightId;
    element.dataset.octobaseHighlightText = text;
  }

  return highlightId;
}

export function getHighlightDragPayload(element: HighlightIdElement): {
  highlightId: string;
  text: string;
} {
  return {
    highlightId: getOrCreateHighlightId(element),
    text: element.dataset.octobaseHighlightText || element.textContent || '',
  };
}

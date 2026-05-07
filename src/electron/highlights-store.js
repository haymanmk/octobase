import { promises as fs } from "node:fs";
import path from "node:path";

const HIGHLIGHTS_FILE = "highlights.json";
const CARDS_FILE = "whiteboard.json";

async function readJson(filePath) {
  try {
    const buf = await fs.readFile(filePath, "utf8");
    return JSON.parse(buf);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export function createStore(dataDir) {
  const highlightsPath = path.join(dataDir, HIGHLIGHTS_FILE);
  const cardsPath = path.join(dataDir, CARDS_FILE);

  async function loadAllHighlights() {
    return await readJson(highlightsPath);
  }

  async function loadHighlightsForUrl(url) {
    const all = await loadAllHighlights();
    return all.filter((h) => h.sourceUrl === url);
  }

  async function saveHighlight(highlight) {
    const all = await loadAllHighlights();
    const idx = all.findIndex((h) => h.id === highlight.id);
    if (idx >= 0) all[idx] = highlight;
    else all.push(highlight);
    await writeJson(highlightsPath, all);
    return highlight;
  }

  async function deleteHighlight(id) {
    const all = await loadAllHighlights();
    const next = all.filter((h) => h.id !== id);
    if (next.length !== all.length) await writeJson(highlightsPath, next);
  }

  async function listTags() {
    const all = await loadAllHighlights();
    const set = new Set();
    for (const h of all) for (const t of h.tags || []) set.add(String(t).toLowerCase());
    return [...set].sort();
  }

  async function loadCards() {
    return await readJson(cardsPath);
  }

  async function saveCard(card) {
    const all = await loadCards();
    const idx = all.findIndex((c) => c.id === card.id);
    if (idx >= 0) all[idx] = card;
    else all.push(card);
    await writeJson(cardsPath, all);
    return card;
  }

  async function deleteCard(id) {
    const all = await loadCards();
    const next = all.filter((c) => c.id !== id);
    if (next.length !== all.length) await writeJson(cardsPath, next);
  }

  async function syncCardFromHighlight(highlight) {
    const all = await loadCards();
    const idx = all.findIndex((c) => c.id === highlight.id);
    if (idx < 0) return null;
    const updated = {
      ...all[idx],
      text: highlight.text,
      sourceUrl: highlight.sourceUrl,
      color: highlight.color,
      tags: highlight.tags,
      notes: highlight.notes,
      updatedAt: highlight.updatedAt,
    };
    all[idx] = updated;
    await writeJson(cardsPath, all);
    return updated;
  }

  return {
    loadAllHighlights,
    loadHighlightsForUrl,
    saveHighlight,
    deleteHighlight,
    listTags,
    loadCards,
    saveCard,
    deleteCard,
    syncCardFromHighlight,
  };
}

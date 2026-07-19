# Octobase UI unification — developer handoff

Final design: **Direction A** (Fraunces display, Lucide 2px icons, left-edge card accent) on the **3b neutral-grey** tokens with the **5a "Sunset retreat"** card/highlight palette. Reference: `Octobase UI.dc.html` sections 4a–4e.

---

## 1 · `src/components/highlighter/colors.ts` — the 5a palette

`HIGHLIGHT_PALETTE.underline` drives card accents (`CanvasCard.tsx:231`), highlighter swatches, and marker fills, so this single edit recolors cards, pills, popovers, canvas color dots, and highlights in app + extension + reader.

```ts
export const HIGHLIGHT_PALETTE: Record<
  HighlightColor,
  { fill: string; darkFill: string; underline: string }
> = {
  yellow: { fill: "#ffedbd", darkFill: "#7a5f14", underline: "#ffd166" }, // note
  blue:   { fill: "#c3e5f1", darkFill: "#0d5f7a", underline: "#118ab2" }, // highlight
  green:  { fill: "#c1f5e7", darkFill: "#045d46", underline: "#06d6a0" }, // article
  pink:   { fill: "#fbd0da", darkFill: "#7d1330", underline: "#ef476f" }, // clip
  purple: { fill: "#c8dbe2", darkFill: "#0b4f66", underline: "#073b4c" }, // pdf
  orange: { fill: "#fde2d8", darkFill: "#8a3c22", underline: "#f78c6b" }, // extra
};
```

Icon tints (kind glyphs at 12–15px need more contrast than the light edges):
- note → `#c28f1f` (light) / `#ffd166` (dark theme)
- article → `#0aa87e` (light) / `#06d6a0` (dark)
- highlight/dark → `#55c1e7`; all other kinds use `underline` as-is.

## 2 · `src/workspace/workspace.css` — replace the `:root` block

```css
:root {
  --ws-ink: #212123;
  --ws-ink-soft: #56565a;
  --ws-ink-muted: #8e8e91;   /* was scattered #8f939c literals */
  --ws-ink-faint: #9c9ca0;
  --ws-paper: #f7f7f7;
  --ws-paper-2: #eeeeee;
  --ws-card: #ffffff;
  --ws-line: #e3e3e3;
  --ws-line-strong: #d0d0d2;
  --ws-accent: #4f7dc9;
  --ws-accent-soft: rgba(79, 125, 201, 0.32);
  --ws-danger: #b4452f;
  --ws-dot: rgba(115, 115, 118, 0.22);
  --ws-radius: 10px;          /* was 12px */
  /* fonts + shadows unchanged */
}
[data-theme="dark"] {
  --ws-ink: #ececee;
  --ws-ink-soft: #a3a3a8;
  --ws-ink-muted: #707076;
  --ws-paper: #1b1b1d;
  --ws-paper-2: #212124;     /* chrome: sidebar / viewer */
  --ws-card: #29292c;
  --ws-line: #343437;
  --ws-line-strong: #3d3d41;
  --ws-accent: #7ba2e0;
  --ws-dot: rgba(255, 255, 255, 0.07);
}
```

Notes:
- **Sidebar drops the dark spine.** The final light UI uses chrome grey (`--ws-paper-2`) for the sidebar/library/viewer panes — retire `--ws-spine*` (or alias them to paper-2/ink for a soft migration).
- **Card accent: 5px top bar → 3px left edge.** Replace `.ws-card .ws-card-accent { height: 5px; }` with `width: 3px` on the card's left side (simplest: `border-left: 3px solid` set inline where the 5px bar div was, or keep the div with `position:absolute; left:0; top:0; bottom:0; width:3px`). Same change in `LibraryPanel` mini-cards (they use a 3px top edge in the mock — either is fine, keep one rule).
- Sweep the stray warm literals (`#998d77`, `#b3a890`, `#6f654f`, `#8f939c`) → the new token equivalents.

## 3 · `src/components/highlighter/toolbar-ui.ts`

```ts
const FONT = "'Spline Sans', ui-sans-serif, system-ui, sans-serif";
```
Grey literals → tokens: `#eee`/`#e4e4e7`/`#e5e5e5` → `#e3e3e3`; `#666` → `#56565a`; `#111` → `#212123`; popover `color`/`outline`/`.octo-pop-primary` `#1f2126` → `#212123`. Focus ring `#4f7dc9` stays. (The Lit widget + extension content script inherit via `toolbarCss()` — no further edits.)

## 4 · `dist-extension/popup.html` (and its source) — drop the warm palette

```css
:root { --ink:#212123; --paper:#f7f7f7; --card:#ffffff;
        --accent:#4f7dc9; --line:#e3e3e3; --muted:#8e8e91; --soft:#56565a; }
body { font-family: "Spline Sans", system-ui, sans-serif; }
h1   { font-family: "Fraunces", Georgia, serif; font-weight: 600; }
.led.on  { background: #0aa87e; }   /* was #16a34a */
.led.off { background: #b4452f; }
input { font-family: "JetBrains Mono", ui-monospace, monospace; }
.status, summary, label { color: var(--soft); }
.hint, .queue { color: var(--muted); }
```
Bundle the three fonts with the extension (or keep system-ui fallbacks — no remote fonts in MV3 popups without listing them).

## 5 · Icons

Replace all emoji/unicode glyphs (`KIND_GLYPH` maps in `TocPanel.tsx`, `LibraryPanel.tsx`, `wikilink-suggest.ts`, `ViewerHost.tsx` 📄/📖) with **Lucide, stroke 2**:
- React surfaces: `lucide-react` tree-shaken imports — `StickyNote` (note), `Highlighter` (highlight), `Newspaper` (article), `Image` (clip), `FileText` (pdf).
- Lit widget + extension: `lucide-static` SVGs inlined via CSS mask (pattern used throughout the mock).
- Sizes 13 / 15 / 17px; icon buttons 32×32, min hit target 28px.

## 6 · Geometry & type recap

- Spacing 4 / 8 / 12 / 16 / 24 · radius 7 (inputs) / 10 (cards) / 999 (pills)
- Fraunces 600 → brand, board/card/reader titles · Spline Sans → all UI · JetBrains Mono → counts, kbd, URLs, ports
- Slide text/type scale unchanged from current build otherwise.

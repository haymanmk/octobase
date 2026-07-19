# Handoff: Octobase UI unification

## Overview
Unify Octobase's three surfaces — the workspace app, the highlighter widget/extension, and the extension popup — under one visual system: **Direction A** (Fraunces display serif + Lucide 2px-stroke icons + 3px left-edge card accents) on the **3b neutral-grey token set**, with the **5a "Sunset retreat" palette** (coral / gold / mint / teal / deep-teal) for card kinds and highlights. Light theme is primary; dark theme uses the same accents on the dark grey set.

## About the design files
`Octobase UI.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behavior, not production code to copy. The task is to **recreate the design in the existing Octobase codebase** (React + MUI workspace, Lit highlighter widget, MV3 extension) using its established patterns. Open the file in a browser; sections **4a–4e** (top of the canvas after turn 5) are the final system:
- **4a** — workspace, light theme
- **4b** — workspace, dark theme
- **4c** — highlighter pill + note popover
- **4d** — extension popup
- **4e** — token & type reference sheet

Earlier sections (1x–3x, 5x) are exploration history — ignore them.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and icon treatments are final. Recreate pixel-perfectly using existing code structure; exact values are in `HANDOFF.md`.

## Implementation map (`HANDOFF.md`)
`HANDOFF.md` in this folder maps every change onto the real source files and is the authoritative spec:
1. `src/components/highlighter/colors.ts` — new `HIGHLIGHT_PALETTE` values (single edit recolors cards, swatches, highlights everywhere)
2. `src/workspace/workspace.css` — replace `:root` tokens, add `[data-theme="dark"]` set, retire the dark sidebar spine, 5px top bar → 3px left edge on `.ws-card-accent`
3. `src/components/highlighter/toolbar-ui.ts` — Spline Sans font stack, grey literal → token sweep
4. `popup.html` (extension) — retheme to neutral greys + Fraunces/Spline Sans/JetBrains Mono
5. Emoji glyphs → Lucide icons (`lucide-react` in React; inline `lucide-static` SVGs in Lit/extension)
6. Geometry: spacing 4/8/12/16/24, radius 7/10/999

## Suggested agent decomposition
These are independent and can run as parallel Claude Code tasks (or sequential sessions):
- **Task 1 — palette**: colors.ts `HIGHLIGHT_PALETTE` + icon-tint helpers (HANDOFF §1)
- **Task 2 — workspace tokens**: workspace.css `:root`/dark block, card-accent geometry, warm-literal sweep (§2)
- **Task 3 — highlighter + popup**: toolbar-ui.ts and popup retheme (§3–4)
- **Task 4 — icons**: emoji → Lucide across `TocPanel.tsx`, `LibraryPanel.tsx`, `wikilink-suggest.ts`, `ViewerHost.tsx`, Lit widget (§5)
Task 1 should land before 2 (dark-theme card checks); 3 and 4 are fully independent.

## Design tokens (light / dark)
- Ink `#212123` / `#ececee` · soft `#56565a` / `#a3a3a8` · muted `#8e8e91` / `#707076`
- Paper `#f7f7f7` / `#1b1b1d` · chrome `#eeeeee` / `#212124` · card `#ffffff` / `#29292c`
- Line `#e3e3e3` / `#343437` · strong `#d0d0d2` / `#3d3d41`
- Accent (interactive) `#4f7dc9` / `#7ba2e0` · danger `#b4452f`
- Card kinds (5a): note `#ffd166` · highlight `#118ab2` · article `#06d6a0` · clip `#ef476f` · pdf `#073b4c` · extra `#f78c6b` (fills/darkFills in HANDOFF §1)
- Type: Fraunces 600 (display), Spline Sans (UI), JetBrains Mono (counts/kbd/URLs)

## Files in this bundle
- `README.md` — this file
- `HANDOFF.md` — file-by-file implementation spec (authoritative)
- `Octobase UI.dc.html` + `support.js` — the design reference; open the HTML directly in a browser
- `screenshots/` — PNG captures of the final sections: `4a-workspace-light`, `4b-workspace-dark`, `4c-highlighter`, `4d-popup`, `4e-tokens`

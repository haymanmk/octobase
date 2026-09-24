# Highlight toolbar fixes and verification — 2026-09-13

This change builds on the in-progress shared highlight store and anchored overlay.

## Changes

- The shared note SVG is 55% opaque, so its corner badge lets underlying text show through in the native browser, Chrome extension, article reader, and PDF reader.
- The native browser's selection toolbar prevents mouse-down from clearing the selection and ignores its own shadow-DOM mouse events. The three-dot palette stays open.
- The native browser captures a native text anchor before Rangy wraps the selected text. A note save snapshots its values before awaiting the store, so clicking Done cannot replace the pending note with reset values.
- Add note creates a yellow highlight and opens its editor on every surface. It no longer merely pulses the reader's colour buttons, and is available in the extension.
- Reader/card changes publish highlight upserts and deletes to the native browser. Existing Rangy fragments are updated without adding a duplicate range overlay.
- Highlight lookup ignores URL fragments. A source URL with a section fragment refers to the same article.
- Extension reverse sync includes notes, including cleared notes. It refreshes on focus/visibility and every five seconds while the visible page has no open highlight controls.
- Extension local writes and refreshes run sequentially. Service-worker sends and queue flushes also run sequentially; older queued changes must complete before newer changes. Reverse sync is skipped while writes remain queued.
- A workspace response timeout is an error instead of an authoritative empty highlight list, preventing a timeout from being interpreted as mass deletion by the extension.

## Verification

- `npm run build`: passed (existing large-bundle advisory remains).
- `npm run build:extension`: passed; the installed unpacked extension was reloaded.
- `npm test`: 212 passed, 0 failed. New regression tests cover note reconciliation and clearing, remote deletion versus unsent local highlights, fragment URL matching, and ordered offline queue replay.
- Focused ESLint checks on changed TypeScript and new tests: passed. Full-repository lint remains blocked by existing generated-file and unrelated source errors; PDF reader also has existing unused suppression warnings.
- Real Electron UI: select text → expand three-dot palette → Add note → type → Done → reload → reopen. Verified the saved note and translucent badge.
- Real Chrome UI: expand palette and Add note; read a desktop-created note; edit it in Chrome and reopen it in the desktop browser without reload.
- Real article reader: expand palette, Add note, save and reopen; recolor from yellow to green, switch to the already-loaded original page, and observe green without reload.
- Removed the five temporary QA highlights through the capture API. The tested reader returned from 12 to its original 11 highlights; the example page has no remaining test highlights.
- PDF uses the same badge and equivalent Add note change; its updated code passed type checking/build, but PDF interaction was not manually exercised in this pass.

## Suggested next improvements

1. Preserve each article reader's scroll position across tab switches. Switching from the original webpage back to the reader returned it to the top during testing.
2. Show a small connection/sync status in the highlight controls. A user should be able to distinguish saved locally, queued, and synced without opening extension settings.
3. Offer a margin placement for note badges. Transparency reduces obstruction, but a badge can still overlap text on the previous line when line spacing is tight.
4. Consolidate toolbar behavior, not only CSS. The Lit, React, and extension DOM implementations still have different edit forms and save conventions; shared interaction rules and cross-surface regression coverage would reduce future drift.

## 2026-09-14 follow-up: badge/menu collision

The native browser's hover menu now reserves the note badge's half-width plus
6 pixels before placing its 22-pixel button. If that would exceed the right
viewport edge, it places the menu below the highlight instead. Pointer movement
inside the menu no longer repositions it against underlying article text.
Verified the separate badge and menu on the reported article in Electron and
clicked the menu. Highlighter build, TypeScript checking and focused lint passed.
The temporary verification highlight was removed.

### Upper-left placement

Following the user's layout preference, the badge now docks at the upper-left
of the first text rect/band in all four surfaces. Wrapped highlights use their
first line; the three-dot menu remains outside the right edge. Updated the
existing geometry tests, verified the position visually in Electron, and removed
the temporary test highlight. Both builds and all 212 tests pass.

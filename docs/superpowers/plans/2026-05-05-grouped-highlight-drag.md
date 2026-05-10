# Grouped Highlight Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging any Rangy fragment created from one user selection creates one Card with the full selected text and one stable highlight ID.

**Architecture:** Keep Rangy's physical `.highlighted-text` fragments, but add a small metadata helper that stamps every fragment in a selection with the same `data-octobase-highlight-id` and `data-octobase-highlight-text`. The highlighter drag handler reads those shared values, falling back to fragment-local behavior for older highlights.

**Tech Stack:** TypeScript, Rangy, Lit, Electron IPC, Node's built-in test runner.

---

### Task 1: Group Metadata Helper

**Files:**
- Modify: `src/components/highlighter/highlight-id.ts`
- Modify: `test/highlight-id.test.ts`

- [ ] **Step 1: Write failing grouped-fragment tests**

Add tests showing that two fragment-like elements stamped from the same selection receive the same ID and full text:

```ts
import {
  getHighlightDragPayload,
  getOrCreateHighlightId,
  stampHighlightGroup,
} from '../src/components/highlighter/highlight-id.ts';

test('stamps every fragment in one selection with shared drag metadata', () => {
  const fragments = [
    { dataset: {}, textContent: 'Read ' },
    { dataset: {}, textContent: 'docs' },
  ];

  stampHighlightGroup(fragments, 'Read docs', () => 'hl-group');

  assert.equal(fragments[0].dataset.octobaseHighlightId, 'hl-group');
  assert.equal(fragments[1].dataset.octobaseHighlightId, 'hl-group');
  assert.equal(fragments[0].dataset.octobaseHighlightText, 'Read docs');
  assert.equal(fragments[1].dataset.octobaseHighlightText, 'Read docs');
});

test('drag payload uses grouped text instead of fragment text', () => {
  const fragment = {
    dataset: {
      octobaseHighlightId: 'hl-group',
      octobaseHighlightText: 'Read docs',
    },
    textContent: 'docs',
  };

  assert.deepEqual(getHighlightDragPayload(fragment), {
    highlightId: 'hl-group',
    text: 'Read docs',
  });
});
```

- [ ] **Step 2: Verify red**

Run: `npm test`

Expected: FAIL because `stampHighlightGroup` and `getHighlightDragPayload` are not exported yet.

- [ ] **Step 3: Implement helper functions**

Add:

```ts
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
```

Make `HighlightIdElement` include `textContent: string | null`.

- [ ] **Step 4: Verify green**

Run: `npm test`

Expected: PASS.

### Task 2: Wire Group Metadata Into Rangy

**Files:**
- Modify: `src/components/highlighter/highlighter.ts`

- [ ] **Step 1: Capture one selected text and all created fragments**

Before `rangy.createClassApplier`, capture:

```ts
const selection = rangy.getSelection();
const selectedText = selection.toString();
const highlightedElements: HTMLElement[] = [];
```

In `onElementCreate`, push each `htmlEl` into `highlightedElements`.

- [ ] **Step 2: Stamp the group after Rangy mutates the DOM**

After `highlighter.highlightSelection('highlighted-text')`, call:

```ts
if (selectedText.length > 0) {
  stampHighlightGroup(highlightedElements, selectedText);
}
```

- [ ] **Step 3: Use grouped payload during drag**

Replace fragment-local text and ID reads in `triggerDrag` with:

```ts
const { text, highlightId } = getHighlightDragPayload(htmlEl);
if (text.length === 0) { cleanup(); return; }
```

Send `text` and `highlightId` in both IPC and `postMessage` payloads.

- [ ] **Step 4: Verify build and tests**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

### Task 3: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run lint and record current status**

Run: `npm run lint`

Expected: may still fail on existing generated/types issues unrelated to grouped highlight metadata.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- package.json src/components/highlighter/highlighter.ts src/components/highlighter/highlight-id.ts test/highlight-id.test.ts
```

Expected: diff only changes highlight metadata grouping, test script, and focused tests.

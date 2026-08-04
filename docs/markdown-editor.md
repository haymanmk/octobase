# In-app Markdown editor

This guide explains the editor as it exists today, with an emphasis on finding
content-loss bugs. The central fact is that the editor is not editing a Markdown
string directly: while a session is open, TipTap/ProseMirror owns a structured
document and serializes the whole document back to Markdown after every
transaction.

## The shortest useful mental model

```text
card.body (Markdown)
        |
        | mount / mode switch
        v
TipTap Markdown parser (markdown-it)
        |
        v
ProseMirror document  <--- typing, paste, commands, block moves
        |
        | every onUpdate: markdown.getMarkdown()
        v
Markdown draft in the host component
        |
        | blur / Cmd+Enter, or 500 ms pane autosave
        v
WorkspaceStore.updateCard()
        |
        | 150 ms persistence debounce
        v
localStorage: octobase.workspace.v1
```

There are therefore four different meanings of “the content is gone”:

1. The ProseMirror document has already lost it.
2. The ProseMirror document is intact, but Markdown serialization omits or
   rewrites it.
3. The Markdown draft is intact, but the host did not commit the latest draft.
4. The store is intact, but `MarkdownView` or CSS does not display the content.

Do not start at localStorage. Find the first layer where the text disappears.

## Component map

| File | Responsibility |
|---|---|
| `src/workspace/CardMarkdownEditor.tsx` | Shared TipTap editor, schema/extensions, Markdown serialization, pasted images, block-handle mount. |
| `src/workspace/CanvasCard.tsx` | In-card edit session, draft refs, rich/source toggle, save/cancel-on-blur semantics. |
| `src/workspace/MarkdownEditorPane.tsx` | Full-height viewer editor and rich/source mode handoff. |
| `src/workspace/NoteEditorTab.tsx` | Binds the viewer editor to a card and debounces store commits. |
| `src/workspace/debounced-commit.ts` | Framework-free 500 ms write-behind with an unmount flush. |
| `src/workspace/block-handles.tsx` | Hover grip, block actions, native drag capture, and drop-boundary selection. |
| `src/workspace/block-move.ts` | Pure top-level block move transaction. |
| `src/workspace/markdown-lists.ts` | Markdown serializer override that keeps adjacent bullet/task lists separate. |
| `src/workspace/card-embed-node.ts` | Block atom and Markdown parser/serializer for `![[embed]]`. |
| `src/workspace/math-extension.ts` | KaTeX decorations and math-aware text serialization. |
| `src/workspace/slash-menu.ts` | Slash-command transactions and caret popup. |
| `src/workspace/wikilink-suggest.ts` | `[[` suggestion transactions and wikilink/embed insertion. |
| `src/workspace/MarkdownView.tsx` | Separate read path: `react-markdown` + remark/rehype. It does not share TipTap's parser. |
| `src/lib/store/workspace-store.ts` | Card mutation and the 150 ms localStorage persistence schedule. |

## One editor, two hosts

### Canvas card editor

`CanvasCard` owns `bodyDraft` as a ref. Entering edit mode copies `card.body`
into that ref, then mounts `CardMarkdownEditor` with it. Every TipTap update
replaces the ref with a complete Markdown serialization.

The draft is committed when focus leaves the edit box or on Cmd/Ctrl+Enter.
Escape restores the current store value and ends the session without saving.
Moving focus between the title and body does not commit, and the portalled
block handle is explicitly treated as still inside the editing session.

The body comparison uses `bodyDraft.current.trim() !== card.body.trim()`.
Consequently, a change consisting only of leading/trailing whitespace is not
written. Ordinary word changes, including words in the last paragraph, are not
supposed to be filtered here.

### Viewer-pane note editor

`NoteEditorTab` and `MarkdownEditorPane` form the long-form editor. Body/title
changes update one whole-draft ref and restart a 500 ms debouncer. The commit
reads the current card, creates a patch from the newest draft, and calls
`WorkspaceStore.updateCard`. Unmounting the tab flushes a pending commit.

The store mutates the in-memory `WorkspaceData` immediately, notifies React,
then waits another 150 ms before saving a snapshot to localStorage. This second
debounce affects durability, not the current in-memory card.

## Session ownership and remounting

`CardMarkdownEditor` calls `useEditor(..., [])`. Its `value` prop is initial
content only; later prop changes are intentionally ignored. The live
ProseMirror document owns the session until the component unmounts.

Switching between rich and source modes unmounts one surface and mounts the
other:

- rich -> source serializes continuously into the host ref, then seeds the
  textarea from that ref;
- source -> rich updates a seed state, then creates a new TipTap document from
  the latest Markdown;
- opening a different viewer tab also creates a new session, while the old
  tab's pending store commit is flushed.

This makes a mode switch a useful diagnostic checkpoint: if source mode is
already missing text, the problem occurred in the document or serializer. If
source contains it but read mode does not, inspect the store or renderer.

## The Markdown round trip

The default path is:

```text
Markdown -> tiptap-markdown/markdown-it -> ProseMirror nodes
ProseMirror nodes -> tiptap-markdown serializer -> Markdown
```

These representations are not naturally one-to-one, so the app has several
schema and serializer overrides:

- `PersistentParagraph` writes an empty paragraph as `&nbsp;`; otherwise blank
  Markdown lines would collapse and an intentional empty block would vanish.
- `SeparatedBulletList` and `SeparatedTaskList` alternate `-` and `*` markers
  along adjacent list runs. Without this, Markdown parsers merge neighboring
  bullet/task-list nodes into one list.
- `CardEmbedNode` parses and writes standalone `![[target|label]]` blocks as
  block atoms. It consumes multi-line targets until the closing `]]`.
- `MathAwareText` writes `$...$` and `$$...$$` spans verbatim so the default
  escaping does not corrupt LaTeX.
- `markdownOf` calls `unescapeWikilinks` because the stock serializer escapes
  the opening brackets of `[[links]]`.
- `ClipImage` stores portable `clip:<file>` references and resolves them to an
  Electron protocol URL only while rendering.
- `EditorCodeBlock` replaces StarterKit's code block but retains fenced-code
  Markdown serialization.

Extension order matters. StarterKit has paragraph, bullet-list, code-block,
and drop-cursor support disabled because the app supplies replacements. The
math-aware text extension is registered after StarterKit specifically so its
serializer wins.

The read path is different. `MarkdownView` preprocesses wikilinks/embeds and
uses `react-markdown`, `remark-gfm`, `remark-math`, KaTeX, and highlight.js.
A document can therefore serialize correctly yet render differently in edit
and read modes. Both parsers must be included in round-trip tests.

## Block dragging and why it is high risk

The block grip is a body-level React portal, outside the ProseMirror DOM. An
older implementation let ProseMirror handle the drop. ProseMirror removed the
current selection at drop time, but focusing the grip could change that
selection; the result could duplicate the dragged block and remove text from an
unrelated block. That symptom could look like words disappearing near the end.

The current path deliberately bypasses ProseMirror's native drop logic:

1. Hover maps a top-level DOM child to the same top-level document index.
2. Drag start carries OS drag data but does not set a ProseMirror dragging
   slice.
3. Capture-phase listeners on the whole card/editor zone stop the event before
   ProseMirror or the canvas sees it.
4. The nearest visual block boundary becomes an insertion index. The boundary
   after the last block is `doc.childCount`.
5. `moveTopLevelBlock(state, fromIndex, toIndex)` deletes the node identified
   by its current index and inserts that same node through the transaction's
   mapping. It never consults the selection.

Dropping on either boundary touching the source block is a no-op. For a
downward move, the insertion position must be mapped through the deletion;
otherwise the block lands one position too far down.

Embed blocks have one extra path. A grip drag that is successfully handled by
the canvas or another card removes the original embed from its host in
`onDragEnd`. This removal is gated by the `CARD_DRAG_MIME` handshake and by the
drop not being over `.ws-card-md-edit`.

## What is special about the bottom

There is no bottom-of-document cleanup or truncation rule. The last area has a
few mechanical differences worth testing:

- The final drop boundary uses the last DOM child's `rect.bottom` and the
  insertion index `doc.childCount`.
- `topLevelPos(doc, doc.childCount)` is `doc.content.size`.
- The editor is inside a scroll wrapper; the ProseMirror element has
  `min-height: 100%`/`flex: 1`, and the wrapper owns vertical overflow.
- Markdown has weak representation for trailing blank lines. Empty paragraphs
  survive only because `PersistentParagraph` emits `&nbsp;`.
- The last Markdown block has no following block to expose an accidental merge
  or missing separator, so inspecting only the rendered page can be misleading.

If actual words disappear, trailing-blank-line normalization alone is not an
adequate explanation. Capture the last two blocks and determine which layer
first loses their text.

## A practical content-loss investigation

Use a short, unique sentinel at the end, for example
`END_SENTINEL_7f3a`, and record the precise action immediately before it
vanishes.

### 1. Check the ProseMirror document

Pause in `CardMarkdownEditor`'s `onUpdate` before `onChange` runs and inspect:

```js
e.state.doc.toJSON()
e.state.doc.textContent
e.state.selection.toJSON()
```

If the sentinel is absent here, inspect the transaction that just ran. The
highest-risk writers are block moves, slash/wiki suggestion commands, paste,
embed removal after an external drop, and normal input rules.

### 2. Check serialization

In the same callback, compare the document above with:

```js
e.storage.markdown.getMarkdown()
```

If the ProseMirror document contains the sentinel but Markdown does not, reduce
the last blocks to a parser/serializer regression. Record node types and attrs,
not just visible text. Add the case to a round-trip test that constructs or
parses the full document and asserts the sentinel survives serialization and a
second parse.

### 3. Check the host draft and store commit

If serialized Markdown is intact, inspect:

- `bodyDraft.current` and `commitEdit` in `CanvasCard` for an in-card session;
- `draft.current`, the debounced callback, and its unmount cleanup in
  `NoteEditorTab` for the viewer-pane session;
- the `patch` passed to `WorkspaceStore.updateCard`.

Do not confuse the 500 ms editor debounce with the store's 150 ms persistence
debounce. Check `store.getCard(id).body` before checking localStorage.

### 4. Check persistence and read rendering

The persisted workspace is JSON under the localStorage key
`octobase.workspace.v1`. If both the store and JSON contain the sentinel, the
data is safe; inspect `MarkdownView`'s preprocessing/remark tree and the scroll
or card CSS instead.

### 5. Record a minimal structural reproduction

A useful bug report contains:

- which host: canvas card or viewer pane;
- rich or source mode;
- exact last 2-3 Markdown blocks before the action;
- action: typing, Backspace/Delete, paste, slash command, suggestion, block
  action, internal block drag, or external embed drag;
- canvas zoom if dragging is involved;
- ProseMirror JSON before/after;
- serialized Markdown before/after;
- whether a mode switch, blur, tab switch, or app restart is required to see
  the loss.

## Existing regression coverage

- `test/block-move.test.ts` checks every source/target pair, ignores stale
  selections, preserves nested attributes, round-trips moves, and fuzzes 300
  random documents.
- `test/markdown-lists.test.ts` checks adjacent list separation against both
  markdown-it (editor) and remark-gfm (read view).
- `test/debounced-commit.test.ts` checks latest-value wins, delay restart,
  flush, cancel, and empty flush.
- Embed, wikilink, math, image-ref, and store behavior have focused unit tests
  elsewhere in `test/`.

The major gap is an integration test around the complete editor schema and
real `markdown.getMarkdown()` path. The current tests prove the pure block move,
list marker selection, and debounce independently; they do not prove that a
long mixed document survives every TipTap transaction and repeated
Markdown -> ProseMirror -> Markdown cycles. A content-loss fix should add a
minimal round-trip regression at the first failing layer, not only an end UI
test.

## Invariants to preserve when changing the editor

1. During a rich-edit session, ProseMirror is the authority; do not push
   changing `value` props back into it.
2. Every `onChange` value is a complete body, never a patch.
3. A transaction that claims to move one block must preserve every node and
   character except order.
4. UI focus or selection must not identify the source of a block move.
5. Switching rich/source modes must seed the new surface from the latest draft.
6. Closing or switching a viewer tab must flush its pending draft.
7. Custom nodes need both parse and serialize behavior, and must be tested with
   both the editor parser and read renderer where their interpretation differs.
8. Intentional empty blocks, wikilinks, math, adjacent list boundaries, embed
   ids/labels, and portable image refs must survive a round trip.

When a proposed fix violates one of these invariants, it is likely moving the
content-loss bug rather than eliminating it.

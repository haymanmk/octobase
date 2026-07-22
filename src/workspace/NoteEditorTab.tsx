import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { MarkdownEditorPane } from "./MarkdownEditorPane.tsx";
import { createDebouncedCommit } from "./debounced-commit.ts";

/** Keystroke → store write-behind delay. */
const AUTOSAVE_MS = 500;

/**
 * Binds a note card to the pane markdown editor: seeds it once (the session
 * owns the content afterwards) and autosaves title/body with a debounce.
 * Unmount (tab close / switch) flushes the in-flight draft so nothing drops.
 */
export function NoteEditorTab({ cardId }: { cardId: string }): React.ReactElement {
  const store = useWorkspace();
  const card = store.getCard(cardId);

  // Latest drafts, whole-patch: committing title and body together means two
  // quick edits can't race each other out of the debouncer.
  const draft = React.useRef({ title: card?.title ?? "", body: card?.body ?? "" });

  const commit = React.useMemo(
    () =>
      createDebouncedCommit<{ title: string; body: string }>((d) => {
        const current = store.getCard(cardId);
        if (!current) return; // deleted while the tab was open
        const patch: { title?: string; body?: string } = {};
        if (d.title !== current.title) patch.title = d.title.trim() || "Untitled";
        if (d.body !== current.body) patch.body = d.body;
        if (Object.keys(patch).length > 0) store.updateCard(cardId, patch);
      }, AUTOSAVE_MS),
    [store, cardId],
  );

  React.useEffect(() => () => commit.flush(), [commit]);

  if (!card) {
    return <div className="ws-viewer-placeholder">This note no longer exists.</div>;
  }

  return (
    <MarkdownEditorPane
      title={card.title}
      body={card.body}
      cardId={cardId}
      onTitleChange={(title) => {
        draft.current = { ...draft.current, title };
        commit.update(draft.current);
      }}
      onBodyChange={(body) => {
        draft.current = { ...draft.current, body };
        commit.update(draft.current);
      }}
    />
  );
}

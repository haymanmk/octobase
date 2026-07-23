import * as React from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useWorkspace } from "./store-context.ts";
import { EmbedBody } from "./MarkdownView.tsx";

/**
 * Edit-mode node view for ![[embeds]]: renders the same mini-card as the read
 * view, so entering edit mode doesn't reflow embeds into chips. Inert —
 * clicking selects the atom; opening the target stays a view-mode gesture.
 */
export function CardEmbedView({ node }: NodeViewProps): React.ReactElement {
  const store = useWorkspace();
  const ref = String(node.attrs.target ?? "");
  const label = String(node.attrs.label ?? "");
  const target = store.resolveRef(ref);
  return (
    <NodeViewWrapper as="div" className="ws-embed-nodeview" contentEditable={false}>
      {target ? (
        <span className="ws-embed">
          <EmbedBody target={target} />
        </span>
      ) : (
        <span className="ws-embed-chip unresolved">⊞ {label || ref}</span>
      )}
    </NodeViewWrapper>
  );
}

import * as React from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { common, createLowlight } from "lowlight";

/** Shared highlighter (same "common" language set as the rendered views). */
const lowlight = createLowlight(common);

/** Registered language names, for the picker. */
const LANGUAGES = lowlight.listLanguages().sort((a, b) => a.localeCompare(b));

/**
 * Code block node view: the highlighted block plus a small language picker in
 * the top-right corner (visible on hover/focus). Picking a language updates
 * the node's `language` attr — lowlight re-highlights live and the markdown
 * serializer emits it as the fence info string (```c).
 */
function CodeBlockView({ node, updateAttributes }: NodeViewProps): React.ReactElement {
  const language = (node.attrs.language as string | null) ?? "";
  return (
    <NodeViewWrapper className="ws-codeblock">
      <select
        className="ws-codeblock-lang"
        contentEditable={false}
        title="Code block language"
        value={LANGUAGES.includes(language) ? language : ""}
        onChange={(e) => updateAttributes({ language: e.target.value || null })}
      >
        <option value="">plain</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

/**
 * The editor's code block: CodeBlockLowlight (live hljs-* token spans, driven
 * by the fence's language tag) rendered through the node view above.
 */
export const EditorCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });

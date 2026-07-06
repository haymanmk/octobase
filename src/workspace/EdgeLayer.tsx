import * as React from "react";
import type { Edge } from "../lib/model/types.ts";
import {
  edgePath,
  previewPath,
  type Anchor,
  type Point,
  type Rect,
} from "./edge-geometry.ts";

export interface EdgeLayerProps {
  edges: Edge[];
  /** World-space rect of a card's placement on this board; null = not placed. */
  rectOf: (cardId: string) => Rect | null;
  selectedEdgeId: string | null;
  /** Edge whose label is being edited inline; null = none. */
  editingLabelEdgeId: string | null;
  onCommitLabel: (edgeId: string, label: string) => void;
  onEndLabelEdit: () => void;
  /** In-flight handle drag: fixed start anchor to the cursor. */
  preview: { from: Anchor; to: Point } | null;
}

/**
 * The connector layer of the whiteboard. Renders inside the pan/zoom surface
 * (all coordinates are world units) and *before* the cards, so cards paint on
 * top. Paths carry a fat transparent twin (.ws-edge-hit) as the click target;
 * selection, menus, and drag state live in Canvas.
 */
export function EdgeLayer({
  edges,
  rectOf,
  selectedEdgeId,
  editingLabelEdgeId,
  onCommitLabel,
  onEndLabelEdit,
  preview,
}: EdgeLayerProps): React.ReactElement {
  const drawn = edges.flatMap((edge) => {
    const a = rectOf(edge.fromCardId);
    const b = rectOf(edge.toCardId);
    if (!a || !b) return [];
    return [{ edge, geo: edgePath(a, b) }];
  });

  return (
    <>
      <svg className="ws-edges" width="1" height="1" aria-hidden="true">
        <defs>
          <marker id="ws-arrow" viewBox="0 0 10 10" refX="7.5" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L8 5 L1 9" fill="none" stroke="var(--ws-edge)"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <marker id="ws-arrow-sel" viewBox="0 0 10 10" refX="7.5" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1 L8 5 L1 9" fill="none" stroke="var(--ws-accent)"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {drawn.map(({ edge, geo }) => {
          const selected = edge.id === selectedEdgeId;
          return (
            <g key={edge.id}>
              <path
                className={`ws-edge${selected ? " selected" : ""}`}
                d={geo.d}
                markerEnd={edge.directed ? `url(#ws-arrow${selected ? "-sel" : ""})` : undefined}
              />
              <path className="ws-edge-hit" d={geo.d} data-edge-id={edge.id} />
              {selected && (
                <>
                  <circle className="ws-edge-dot" cx={geo.from.x} cy={geo.from.y} r="4" />
                  <circle className="ws-edge-dot" cx={geo.to.x} cy={geo.to.y} r="4" />
                </>
              )}
            </g>
          );
        })}
        {preview && <path className="ws-edge preview" d={previewPath(preview.from, preview.to)} markerEnd="url(#ws-arrow)" />}
      </svg>

      {drawn.map(({ edge, geo }) =>
        edge.id === editingLabelEdgeId ? (
          <EdgeLabelInput
            key={edge.id}
            edge={edge}
            at={geo.mid}
            onCommit={onCommitLabel}
            onEnd={onEndLabelEdit}
          />
        ) : edge.label ? (
          <div
            key={edge.id}
            className={`ws-edge-label${edge.id === selectedEdgeId ? " selected" : ""}`}
            style={{ left: geo.mid.x, top: geo.mid.y }}
            data-edge-id={edge.id}
          >
            {edge.label}
          </div>
        ) : null,
      )}
    </>
  );
}

function EdgeLabelInput({
  edge,
  at,
  onCommit,
  onEnd,
}: {
  edge: Edge;
  at: Point;
  onCommit: (edgeId: string, label: string) => void;
  onEnd: () => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState(edge.label);
  const commit = () => {
    onCommit(edge.id, draft.trim());
    onEnd();
  };
  return (
    <input
      className="ws-edge-label-input"
      style={{ left: at.x, top: at.y }}
      autoFocus
      value={draft}
      placeholder="label"
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onEnd();
      }}
    />
  );
}

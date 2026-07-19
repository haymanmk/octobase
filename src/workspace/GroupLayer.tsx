import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Group } from "../lib/model/types.ts";

export interface GroupLayerProps {
  groups: Group[];
  memberCount: (g: Group) => number;
  /** Group whose name is being edited inline (just-created or double-clicked). */
  renamingId: string | null;
  onCommitRename: (g: Group, name: string) => void;
  onBeginRename: (g: Group) => void;
  onEndRename: () => void;
  onToggleCollapse: (g: Group) => void;
  /** Pointer went down on the pill / chip — Canvas runs the move drag. */
  onStartMove: (g: Group, e: React.PointerEvent) => void;
  onStartResize: (g: Group, e: React.PointerEvent) => void;
  onMenu: (g: Group, x: number, y: number) => void;
  /**
   * A collapsed chip's rendered size in world units (layout px map 1:1 onto
   * placement units), so edges can anchor on the pill the user actually
   * sees, not a guessed box. null = the chip unmounted (group expanded).
   */
  onChipSize: (groupId: string, size: { w: number; h: number } | null) => void;
}

function NamePill({
  group,
  count,
  renaming,
  collapsed,
  props,
}: {
  group: Group;
  count: number;
  renaming: boolean;
  collapsed: boolean;
  props: GroupLayerProps;
}): React.ReactElement {
  return (
    <div
      className="ws-group-pill"
      title={renaming ? undefined : "Drag to move · double-click to rename"}
      onPointerDown={(e) => {
        // Never let a pill press reach the canvas: a right-press would start
        // its pan/menu tracking and open the background menu over this pill.
        e.stopPropagation();
        if (!renaming) props.onStartMove(group, e);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); props.onBeginRename(group); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onMenu(group, e.clientX, e.clientY);
      }}
    >
      <span
        className="ws-group-chevron"
        title={collapsed ? "Expand" : "Collapse"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); props.onToggleCollapse(group); }}
      >{collapsed
        ? <ChevronRight size={13} strokeWidth={2} aria-hidden />
        : <ChevronDown size={13} strokeWidth={2} aria-hidden />}</span>
      {renaming ? (
        <input
          className="ws-group-name-input"
          defaultValue={group.name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              props.onCommitRename(group, e.currentTarget.value);
              props.onEndRename();
            }
            if (e.key === "Escape") props.onEndRename();
          }}
          onBlur={(e) => {
            props.onCommitRename(group, e.currentTarget.value);
            props.onEndRename();
          }}
        />
      ) : (
        <span className="ws-group-name">{group.name || "Untitled"}</span>
      )}
      <span className="ws-group-count">{count}</span>
    </div>
  );
}

/** A collapsed group's chip: the pill alone, measured for edge routing. */
function Chip({
  group,
  count,
  renaming,
  props,
}: {
  group: Group;
  count: number;
  renaming: boolean;
  props: GroupLayerProps;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const { onChipSize } = props;
  // Re-measure when the label content changes; report unmount so edges fall
  // back cleanly instead of anchoring on a stale box.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) onChipSize(group.id, { w: el.offsetWidth, h: el.offsetHeight });
  }, [group.id, group.name, count, renaming, onChipSize]);
  React.useEffect(() => () => onChipSize(group.id, null), [group.id, onChipSize]);
  return (
    <div
      ref={ref}
      className="ws-group-chip"
      style={{ left: group.x, top: group.y }}
      title="Click to expand · drag to move"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onMenu(group, e.clientX, e.clientY);
      }}
    >
      <NamePill group={group} count={count} renaming={renaming} collapsed props={props} />
    </div>
  );
}

/**
 * Named frames and their collapsed chips, rendered behind edges and cards.
 * The frame's interior deliberately ignores the pointer so the canvas keeps
 * its marquee/pan/double-click behavior inside a group; only the pill, the
 * chip, and the resize handle are interactive.
 */
export function GroupLayer(props: GroupLayerProps): React.ReactElement {
  return (
    <>
      {props.groups.map((g) => {
        const count = props.memberCount(g);
        const renaming = props.renamingId === g.id;
        if (g.collapsed) {
          return (
            <Chip key={g.id} group={g} count={count} renaming={renaming} props={props} />
          );
        }
        return (
          <div key={g.id} className="ws-group" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            <NamePill group={g} count={count} renaming={renaming} collapsed={false} props={props} />
            <div
              className="ws-group-resize"
              title="Drag to resize"
              onPointerDown={(e) => props.onStartResize(g, e)}
            />
          </div>
        );
      })}
    </>
  );
}

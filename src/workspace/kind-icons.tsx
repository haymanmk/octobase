import * as React from "react";
import {
  StickyNote,
  Highlighter,
  Newspaper,
  Image,
  FileText,
  type LucideIcon,
} from "lucide-react";

/** Card-kind → Lucide icon (2026-07 unification: Lucide, stroke 2). */
const KIND_ICON: Record<string, LucideIcon> = {
  note: StickyNote,
  highlight: Highlighter,
  article: Newspaper,
  image: Image,
  pdf: FileText,
};

/**
 * A tinted kind glyph. Color comes from the `.ws-kind-<kind>` classes in
 * workspace.css so the tint flips with [data-theme="dark"] automatically.
 */
export function KindIcon({
  kind,
  size = 13,
}: {
  kind: string;
  size?: number;
}): React.ReactElement {
  const Ico = KIND_ICON[kind] ?? StickyNote;
  return <Ico className={`ws-kind-ico ws-kind-${kind}`} size={size} strokeWidth={2} aria-hidden />;
}

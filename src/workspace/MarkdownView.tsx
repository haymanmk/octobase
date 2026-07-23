import * as React from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import type { Card } from "../lib/model/types.ts";
import { clipUrl } from "./electron-bridge.ts";
import { parseClipRef, resolveClipSrc } from "./clip-ref.ts";
import {
  embedHostAt,
  hideDragGhost,
  hideDropCaret,
  moveDragGhost,
  showDragGhost,
  showDropCaret,
} from "./drop-caret.ts";

const EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const WIKI_SCHEME = "wikilink:";
const EMBED_SCHEME = "embed:";

/**
 * Turn ![[Title]] embeds into image nodes and [[Title]] / [[Title|alias]]
 * wikilinks into links, each with a custom scheme. Embeds must go first —
 * the wikilink pattern matches inside them.
 */
function preprocess(body: string): string {
  return body
    .replace(EMBED_RE, (_m, target: string, alias?: string) => {
      const label = (alias ?? target).trim().replace(/[[\]]/g, "");
      return `![${label}](${EMBED_SCHEME}${encodeURIComponent(target.trim())})`;
    })
    .replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
      const label = (alias ?? target).trim().replace(/[[\]]/g, "");
      return `[${label}](${WIKI_SCHEME}${encodeURIComponent(target.trim())})`;
    });
}

/** Markdown body → short plain-text preview (tiles, embed mini-cards). */
export function snippet(body: string, max = 140): string {
  return body
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface MarkdownViewProps {
  body: string;
  resolve?: (title: string) => Card | undefined;
  onOpenCard?: (card: Card) => void;
  onCreateLink?: (title: string) => void;
  /** Embed nesting depth; embeds inside embeds render as plain chips. */
  depth?: number;
  /** The card whose body this renders — embeds exclude it as a drag target. */
  hostCardId?: string;
  /** An embed mini-card was dragged out of this body and released at (x, y). */
  onEmbedDragOut?: (childCard: Card, clientX: number, clientY: number) => void;
}

/** Shared visual body of an ![[embed]] mini-card (read view and the editor's
 *  node view render the same thing, so entering edit mode doesn't reflow). */
export function EmbedBody({ target }: { target: Card }): React.ReactElement {
  const text = snippet(target.body, 120);
  return (
    <>
      <span className="ws-embed-title">{target.title || "Untitled"}</span>
      {target.kind === "image" && (
        <img className="ws-embed-img" src={clipUrl(target.image.file)} alt="" draggable={false} />
      )}
      {text && <span className="ws-embed-snippet">{text}</span>}
    </>
  );
}

/** The nested mini-card an ![[embed]] renders as (depth 0 only). */
function CardEmbed({
  title,
  resolve,
  onOpenCard,
  onCreateLink,
  depth,
  hostCardId,
  onEmbedDragOut,
}: {
  title: string;
  resolve?: (title: string) => Card | undefined;
  onOpenCard?: (card: Card) => void;
  onCreateLink?: (title: string) => void;
  depth: number;
  hostCardId?: string;
  onEmbedDragOut?: (childCard: Card, clientX: number, clientY: number) => void;
}): React.ReactElement {
  const target = resolve?.(title);
  // A completed drag must swallow the click that follows its pointerup.
  const draggedRef = React.useRef(false);

  /** Drag the mini-card out of its host: ghost + caret feedback while the
   *  pointer roams; release hands the drop point to the workspace. */
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!target || !onEmbedDragOut || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    const onMove = (me: PointerEvent) => {
      if (!active) {
        if (Math.abs(me.clientX - sx) + Math.abs(me.clientY - sy) <= 4) return;
        active = true;
        draggedRef.current = true;
        showDragGhost(target.title || "Untitled");
      }
      moveDragGhost(me.clientX, me.clientY);
      const host = embedHostAt(me.clientX, me.clientY, target.id);
      if (host && host.dataset.cardId !== hostCardId) showDropCaret(host, me.clientY);
      else hideDropCaret();
    };
    const onUp = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      hideDragGhost();
      hideDropCaret();
      if (active) {
        onEmbedDragOut(target, ue.clientX, ue.clientY);
        setTimeout(() => { draggedRef.current = false; }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!target || depth > 0) {
    // Unresolved or nested-inside-an-embed: a plain chip. Cycles die here too.
    // Clicking an unresolved chip creates the card, like wikilinks do.
    return (
      <span
        className={`ws-embed-chip${target ? "" : " unresolved"}`}
        title={target ? `Open “${title}”` : `Create “${title}”`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (target) onOpenCard?.(target);
          else onCreateLink?.(title);
        }}
      >⊞ {title}</span>
    );
  }
  return (
    <span
      className="ws-embed"
      title={`Open “${target.title}”`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        if (draggedRef.current) return;
        onOpenCard?.(target);
      }}
    >
      <EmbedBody target={target} />
    </span>
  );
}

// The `components` overrides must keep the same function identity across
// renders: react-markdown uses them as element *types*, so a fresh object per
// render makes React remount every embed/link. A remount mid-gesture
// (pointerdown selects the card → store bump → re-render) replaces the DOM
// node between mousedown and mouseup and the browser never fires the click.
// The overrides are module constants; per-render props reach them via context.
const MdContext = React.createContext<Omit<MarkdownViewProps, "body">>({});

const MdImg: NonNullable<Components["img"]> = ({ src, alt }) => {
  const { resolve, onOpenCard, onCreateLink, depth = 0, hostCardId, onEmbedDragOut } =
    React.useContext(MdContext);
  if (typeof src === "string" && src.startsWith(EMBED_SCHEME)) {
    const title = decodeURIComponent(src.slice(EMBED_SCHEME.length));
    return (
      <CardEmbed
        title={title}
        resolve={resolve}
        onOpenCard={onOpenCard}
        onCreateLink={onCreateLink}
        depth={depth}
        hostCardId={hostCardId}
        onEmbedDragOut={onEmbedDragOut}
      />
    );
  }
  return <img src={typeof src === "string" ? resolveClipSrc(src) : src} alt={alt} />;
};

const MdAnchor: NonNullable<Components["a"]> = ({ href, children }) => {
  const { resolve, onOpenCard, onCreateLink } = React.useContext(MdContext);
  if (href && href.startsWith(WIKI_SCHEME)) {
    const title = decodeURIComponent(href.slice(WIKI_SCHEME.length));
    const target = resolve?.(title);
    const resolved = !!target;
    return (
      <span
        className={`ws-wikilink${resolved ? "" : " unresolved"}`}
        title={resolved ? `Open “${title}”` : `Create “${title}”`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (target) onOpenCard?.(target);
          else onCreateLink?.(title);
        }}
      >
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
};

const MD_COMPONENTS: Partial<Components> = { img: MdImg, a: MdAnchor };

export function MarkdownView({
  body,
  resolve,
  onOpenCard,
  onCreateLink,
  depth = 0,
  hostCardId,
  onEmbedDragOut,
}: MarkdownViewProps): React.ReactElement {
  const processed = React.useMemo(() => preprocess(body), [body]);
  const ctx = React.useMemo(
    () => ({ resolve, onOpenCard, onCreateLink, depth, hostCardId, onEmbedDragOut }),
    [resolve, onOpenCard, onCreateLink, depth, hostCardId, onEmbedDragOut],
  );

  return (
    <div className="ws-md">
      <MdContext.Provider value={ctx}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeHighlight]}
          urlTransform={(url) =>
            url.startsWith(WIKI_SCHEME) || url.startsWith(EMBED_SCHEME) || parseClipRef(url)
              ? url
              : defaultUrlTransform(url)
          }
          components={MD_COMPONENTS}
        >
          {processed}
        </ReactMarkdown>
      </MdContext.Provider>
    </div>
  );
}

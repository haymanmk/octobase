import * as React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Card } from "../lib/model/types.ts";
import { clipUrl } from "./electron-bridge.ts";
import { parseClipRef, resolveClipSrc } from "./clip-ref.ts";

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
}

/** The nested mini-card an ![[embed]] renders as (depth 0 only). */
function CardEmbed({
  title,
  resolve,
  onOpenCard,
  onCreateLink,
  depth,
}: {
  title: string;
  resolve?: (title: string) => Card | undefined;
  onOpenCard?: (card: Card) => void;
  onCreateLink?: (title: string) => void;
  depth: number;
}): React.ReactElement {
  const target = resolve?.(title);
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
  const text = snippet(target.body, 120);
  return (
    <span
      className="ws-embed"
      title={`Open “${target.title}”`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpenCard?.(target); }}
    >
      <span className="ws-embed-title">{target.title || "Untitled"}</span>
      {target.kind === "image" && (
        <img className="ws-embed-img" src={clipUrl(target.image.file)} alt="" draggable={false} />
      )}
      {text && <span className="ws-embed-snippet">{text}</span>}
    </span>
  );
}

export function MarkdownView({
  body,
  resolve,
  onOpenCard,
  onCreateLink,
  depth = 0,
}: MarkdownViewProps): React.ReactElement {
  const processed = React.useMemo(() => preprocess(body), [body]);

  return (
    <div className="ws-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith(WIKI_SCHEME) || url.startsWith(EMBED_SCHEME) || parseClipRef(url)
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          img({ src, alt }) {
            if (typeof src === "string" && src.startsWith(EMBED_SCHEME)) {
              const title = decodeURIComponent(src.slice(EMBED_SCHEME.length));
              return (
                <CardEmbed
                  title={title}
                  resolve={resolve}
                  onOpenCard={onOpenCard}
                  onCreateLink={onCreateLink}
                  depth={depth}
                />
              );
            }
            return <img src={typeof src === "string" ? resolveClipSrc(src) : src} alt={alt} />;
          },
          a({ href, children }) {
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
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

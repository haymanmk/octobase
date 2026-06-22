import * as React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Card } from "../lib/model/types.ts";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const WIKI_SCHEME = "wikilink:";

/** Turn [[Title]] / [[Title|alias]] into markdown links with a custom scheme. */
function preprocess(body: string): string {
  return body.replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim().replace(/[[\]]/g, "");
    return `[${label}](${WIKI_SCHEME}${encodeURIComponent(target.trim())})`;
  });
}

export interface MarkdownViewProps {
  body: string;
  resolve?: (title: string) => Card | undefined;
  onOpenCard?: (card: Card) => void;
  onCreateLink?: (title: string) => void;
}

export function MarkdownView({
  body,
  resolve,
  onOpenCard,
  onCreateLink,
}: MarkdownViewProps): React.ReactElement {
  const processed = React.useMemo(() => preprocess(body), [body]);

  return (
    <div className="ws-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith(WIKI_SCHEME) ? url : defaultUrlTransform(url)
        }
        components={{
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

import * as React from "react";
import { Sparkles, X } from "lucide-react";
import "./chat.css";
import { useWorkspace } from "./store-context.ts";
import { buildCardContext } from "./ai-context.ts";
import { getAiBridge, type AiChatMessage } from "./electron-bridge.ts";
import type { Card } from "../lib/model/types.ts";

export interface ChatDrawerProps {
  card: Card;
  onClose: () => void;
  /** Open the AI settings popover (shown when no key is configured). */
  onOpenSettings: () => void;
}

interface Bubble {
  role: "user" | "assistant";
  content: string;
  saved?: boolean;
}

/**
 * Ask-about-this-card chat, docked under the reader. Context is the card's
 * content (for PDFs, the parsed whole-document markdown); answers stream in
 * from the main-process OpenAI client. History lives for the session only;
 * any answer can be saved as a linked note card.
 */
export function ChatDrawer({ card, onClose, onOpenSettings }: ChatDrawerProps): React.ReactElement {
  const store = useWorkspace();
  const bridge = getAiBridge();
  const [bubbles, setBubbles] = React.useState<Bubble[]>([]);
  const [draft, setDraft] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const reqIdRef = React.useRef<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // Stream deltas into the last assistant bubble. One listener per drawer —
  // the preload bridge replaces prior listeners, and reqId filters strays.
  React.useEffect(() => {
    bridge?.onAiChatDelta(({ reqId, delta }) => {
      if (reqId !== reqIdRef.current) return;
      setBubbles((bs) => {
        const next = [...bs];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, content: last.content + delta };
        }
        return next;
      });
    });
  }, [bridge]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [bubbles, streaming]);

  const contextFor = async (): Promise<{ system: string; truncated: boolean }> => {
    let fullText: string | null = null;
    if (card.kind === "pdf") {
      const { ensurePdfText } = await import("./pdf-text-cache.ts");
      fullText = await ensurePdfText(card);
    }
    return buildCardContext(card, fullText);
  };

  const send = async () => {
    const question = draft.trim();
    if (!question || streaming || !bridge) return;
    setDraft("");
    setError(null);
    const history = [...bubbles, { role: "user" as const, content: question }];
    setBubbles([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const ctx = await contextFor();
      setTruncated(ctx.truncated);
      const reqId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      reqIdRef.current = reqId;
      const messages: AiChatMessage[] = [
        { role: "system", content: ctx.system },
        ...history.map((b) => ({ role: b.role, content: b.content })),
      ];
      const res = await bridge.aiChat(reqId, messages);
      if (!res.ok && res.error !== "aborted") setError(res.error ?? "The request failed.");
    } finally {
      reqIdRef.current = null;
      setStreaming(false);
      // Drop an assistant bubble that never received content.
      setBubbles((bs) =>
        bs.length && bs[bs.length - 1].role === "assistant" && !bs[bs.length - 1].content
          ? bs.slice(0, -1)
          : bs,
      );
      inputRef.current?.focus();
    }
  };

  const stop = () => {
    if (reqIdRef.current) bridge?.aiChatAbort(reqIdRef.current);
  };

  const saveAsNote = (index: number) => {
    const bubble = bubbles[index];
    if (!bubble || bubble.saved) return;
    store.createNoteCard({
      title: `Re: ${card.title}`.slice(0, 120),
      body: `${bubble.content.trim()}\n\n— from a chat about [[${card.title}]]`,
      color: card.color,
    });
    setBubbles((bs) => bs.map((b, i) => (i === index ? { ...b, saved: true } : b)));
  };

  const noKey = error?.includes("No API key");

  return (
    <div className="ws-chat">
      <div className="ws-chat-head">
        <span className="ws-chat-title"><Sparkles size={13} strokeWidth={2} aria-hidden /> Ask · {card.title || "Untitled"}</span>
        {truncated && <span className="ws-chat-flag" title="The card content exceeded the context limit">context truncated</span>}
        <span className="ws-topbar-spacer" />
        <button className="ws-icon-btn" title="Close chat" onClick={onClose}><X size={15} strokeWidth={2} aria-hidden /></button>
      </div>
      <div ref={scrollRef} className="ws-chat-scroll">
        {bubbles.length === 0 && (
          <div className="ws-chat-empty">
            Ask anything about this {card.kind === "pdf" ? "PDF" : "card"} — answers cite [page N] markers when they can.
          </div>
        )}
        {bubbles.map((b, i) => (
          <div key={i} className={`ws-chat-msg ${b.role}`}>
            <div className="ws-chat-bubble">
              {b.content || (streaming && i === bubbles.length - 1 ? "…" : "")}
            </div>
            {b.role === "assistant" && b.content && !(streaming && i === bubbles.length - 1) && (
              <button className="ws-chat-save" onClick={() => saveAsNote(i)} disabled={b.saved}>
                {b.saved ? "Saved to library ✓" : "Save as note"}
              </button>
            )}
          </div>
        ))}
        {error && (
          <div className="ws-chat-error">
            {error}
            {noKey && (
              <button className="ws-btn ghost" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }}
                onClick={onOpenSettings}>Open AI settings</button>
            )}
          </div>
        )}
      </div>
      <div className="ws-chat-inputrow">
        <textarea
          ref={inputRef}
          className="ws-chat-input"
          placeholder={`Ask about this ${card.kind === "pdf" ? "PDF" : "card"}…`}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button className="ws-btn" onClick={stop}>Stop</button>
        ) : (
          <button className="ws-btn primary" disabled={!draft.trim()} onClick={() => void send()}>Ask</button>
        )}
      </div>
    </div>
  );
}

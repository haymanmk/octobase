import * as React from "react";
import { useWorkspace } from "./store-context.ts";
import { PALETTE } from "../components/highlighter/colors.ts";
import type { Card } from "../lib/model/types.ts";

export interface InspectorProps {
  cardId: string;
  onClose: () => void;
  onOpenCard: (cardId: string) => void;
  onCreateLink: (title: string) => void;
}

function LinkRow({ card, onClick }: { card: Card; onClick: () => void }) {
  return (
    <div className="ws-link-row" onClick={onClick} title="Open card">
      <span className="ws-dotmark" style={{ background: PALETTE[card.color].underline }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {card.title || "Untitled"}
      </span>
    </div>
  );
}

export function Inspector({
  cardId,
  onClose,
  onOpenCard,
  onCreateLink,
}: InspectorProps): React.ReactElement | null {
  const store = useWorkspace();
  const card = store.getCard(cardId);
  if (!card) return null;

  const outgoing = store.getOutgoingLinks(cardId);
  const backlinks = store.getBacklinks(cardId);
  const unresolved = store.getUnresolvedLinks(cardId);
  const created = new Date(card.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  return (
    <div className="ws-inspector">
      <div className="ws-inspector-head">
        <span className="ws-dotmark" style={{ background: PALETTE[card.color].underline, marginTop: 7 }} />
        <h3 style={{ flex: 1 }}>{card.title || "Untitled"}</h3>
        <button className="ws-btn ghost" style={{ padding: "4px 8px" }} onClick={onClose} title="Close">✕</button>
      </div>
      <div className="ws-inspector-body">
        <div className="ws-insp-label">Outgoing links</div>
        {outgoing.length === 0 ? (
          <div className="ws-insp-empty">No links out. Type [[Title]] in the card to link.</div>
        ) : (
          outgoing.map((c) => <LinkRow key={c.id} card={c} onClick={() => onOpenCard(c.id)} />)
        )}

        <div className="ws-insp-label">Backlinks</div>
        {backlinks.length === 0 ? (
          <div className="ws-insp-empty">Nothing links here yet.</div>
        ) : (
          backlinks.map((c) => <LinkRow key={c.id} card={c} onClick={() => onOpenCard(c.id)} />)
        )}

        {unresolved.length > 0 && (
          <>
            <div className="ws-insp-label">Unresolved</div>
            {unresolved.map((t) => (
              <div key={t} className="ws-link-row" onClick={() => onCreateLink(t)} title="Create this card">
                <span className="ws-dotmark" style={{ background: "transparent", border: "1px dashed var(--ws-danger)" }} />
                <span style={{ color: "var(--ws-danger)" }}>{t}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#a89c84" }}>create →</span>
              </div>
            ))}
          </>
        )}

        <div className="ws-insp-label">Details</div>
        <div className="ws-insp-empty" style={{ fontStyle: "normal", color: "#6f654f" }}>
          {card.kind[0].toUpperCase() + card.kind.slice(1)} · created {created}
          {"sourceUrl" in card && card.sourceUrl ? (
            <>
              <br />
              <a href={card.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--ws-accent)" }}>
                open original ↗
              </a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

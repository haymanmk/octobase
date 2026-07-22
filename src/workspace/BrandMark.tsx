import * as React from "react";

/**
 * The "Ö" face mark (design turn 8): umlaut dots as eyes, the O as a mouth.
 * 8a = gold eyes on the deep-teal tile · 8b = coral/teal eyes on white.
 * Geometry scales from the 128px reference; blink/mouth animation only runs
 * at 32px and up — small marks stay still (design rule: toolbar icons
 * shouldn't move uninvited).
 */
export function BrandMark({
  variant = "light",
  size = 32,
}: {
  variant?: "teal" | "light";
  size?: number;
}): React.ReactElement {
  const k = size / 128;
  const animate = size >= 32;
  const teal = variant === "teal";
  const eyeColors = teal ? ["#ffd166", "#ffd166"] : ["#ef476f", "#118ab2"];
  const eye = Math.max(2, 13 * k);
  return (
    <span
      className="ws-mark"
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(3, 28 * k),
        background: teal ? "#073b4c" : "var(--ws-card)",
        border: teal ? "none" : "1px solid var(--ws-line)",
      }}
    >
      <span className={`ws-mark-eyes${animate ? " animate" : ""}`} style={{ gap: 18 * k }}>
        {eyeColors.map((c, i) => (
          <span key={i} style={{ width: eye, height: eye, borderRadius: "50%", background: c }} />
        ))}
      </span>
      <span className="ws-mark-mouthbox" style={{ height: 60 * k, marginTop: 6 * k }}>
        <span
          className={`ws-mark-mouth${animate ? " animate" : ""}`}
          style={{ fontSize: 74 * k, color: teal ? "#f7f7f7" : "var(--ws-ink)" }}
        >O</span>
      </span>
    </span>
  );
}

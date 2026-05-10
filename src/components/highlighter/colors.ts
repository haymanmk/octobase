import type { HighlightColor } from "../../types/highlight.ts";

export const PALETTE: Record<HighlightColor, { fill: string; underline: string }> = {
  yellow: { fill: "#fff3b0", underline: "#f59e0b" },
  green:  { fill: "#c8e6c9", underline: "#16a34a" },
  pink:   { fill: "#fbcfe8", underline: "#ec4899" },
  blue:   { fill: "#bfdbfe", underline: "#2563eb" },
  purple: { fill: "#e9d5ff", underline: "#9333ea" },
  orange: { fill: "#fed7aa", underline: "#ea580c" },
};

export function classNameFor(color: HighlightColor): string {
  return `octo-hl-${color}`;
}

export function paletteCss(): string {
  return (Object.entries(PALETTE) as Array<[HighlightColor, { fill: string; underline: string }]>)
    .map(
      ([color, { fill }]) => `.${classNameFor(color)} {
  position: relative;
  z-index: 0;
  padding: 0 4px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.${classNameFor(color)}::before {
  content: "";
  position: absolute;
  inset: 20% 0;
  background: ${fill};
  border-radius: 999px;
  z-index: -1;
}
.${classNameFor(color)}:hover::before { filter: brightness(0.97); }`,
    )
    .join("\n");
}

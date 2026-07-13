import type { HighlightColor } from "../../types/highlight.ts";

/**
 * `fill` is the pastel marker band for the usual dark-text-on-light page.
 * `darkFill` is the deep variant swapped in when the highlighted text is
 * light (dark-themed pages) — a pastel band behind white glyphs makes them
 * unreadable, a deep band keeps them crisp.
 */
export const PALETTE: Record<
  HighlightColor,
  { fill: string; darkFill: string; underline: string }
> = {
  yellow: { fill: "#fff3b0", darkFill: "#7a5901", underline: "#f59e0b" },
  green:  { fill: "#c8e6c9", darkFill: "#14532d", underline: "#16a34a" },
  pink:   { fill: "#fbcfe8", darkFill: "#831843", underline: "#ec4899" },
  blue:   { fill: "#bfdbfe", darkFill: "#1e3a8a", underline: "#2563eb" },
  purple: { fill: "#e9d5ff", darkFill: "#581c87", underline: "#9333ea" },
  orange: { fill: "#fed7aa", darkFill: "#7c2d12", underline: "#ea580c" },
};

export function classNameFor(color: HighlightColor): string {
  return `octo-hl-${color}`;
}

/** Modifier class marking a fragment whose own text is light-colored. */
export const ON_DARK_CLASS = "octo-hl-on-dark";

/**
 * Whether a computed CSS color (`rgb(…)` / `rgba(…)` / `#hex`) is light —
 * i.e. the highlighted text needs the deep band variant to stay readable.
 * Unparsable input returns false, keeping the default light-page styling.
 */
export function isLightTextColor(cssColor: string): boolean {
  let r: number, g: number, b: number;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(cssColor);
  const hex = /^#([0-9a-f]{6})$/i.exec(cssColor.trim());
  if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else if (hex) {
    const n = parseInt(hex[1], 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    return false;
  }
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.55;
}

/**
 * Tag every fragment whose own computed text color is light so the CSS can
 * swap its band to the deep variant. Runs per fragment, not per highlight —
 * one selection can span light prose and dark code chips.
 */
export function applyContrastGuard(fragments: Iterable<Element>): void {
  for (const el of fragments) {
    const htmlEl = el as HTMLElement;
    const view = htmlEl.ownerDocument?.defaultView;
    if (!view) continue;
    if (isLightTextColor(view.getComputedStyle(htmlEl).color)) {
      htmlEl.classList.add(ON_DARK_CLASS);
    }
  }
}

export function paletteCss(): string {
  return (Object.entries(PALETTE) as Array<[HighlightColor, (typeof PALETTE)[HighlightColor]]>)
    .map(
      ([color, { fill, darkFill }]) => `.${classNameFor(color)} {
  background-image: linear-gradient(transparent 25%, ${fill} 25%, ${fill} 75%, transparent 75%);
  padding: 0;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.${classNameFor(color)}:hover { filter: brightness(0.97); }
.${classNameFor(color)}.${ON_DARK_CLASS} {
  background-image: linear-gradient(transparent 25%, ${darkFill} 25%, ${darkFill} 75%, transparent 75%);
}
.${classNameFor(color)}.${ON_DARK_CLASS}:hover { filter: brightness(1.15); }`,
    )
    .join("\n");
}

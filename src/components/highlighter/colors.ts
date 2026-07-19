import type { HighlightColor } from "../../types/highlight.ts";

/**
 * `fill` is the pastel marker band for the usual dark-text-on-light page.
 * `darkFill` is the deep variant swapped in when the highlighted text is
 * light (dark-themed pages) — a pastel band behind white glyphs makes them
 * unreadable, a deep band keeps them crisp.
 */
/**
 * The "Sunset retreat" (5a) palette from the 2026-07 UI unification.
 * `underline` doubles as the card-kind accent: yellow=note, blue=highlight,
 * green=article, pink=clip, purple=pdf, orange=extra.
 */
export const PALETTE: Record<
  HighlightColor,
  { fill: string; darkFill: string; underline: string }
> = {
  yellow: { fill: "#ffedbd", darkFill: "#7a5f14", underline: "#ffd166" },
  blue:   { fill: "#c3e5f1", darkFill: "#0d5f7a", underline: "#118ab2" },
  green:  { fill: "#c1f5e7", darkFill: "#045d46", underline: "#06d6a0" },
  pink:   { fill: "#fbd0da", darkFill: "#7d1330", underline: "#ef476f" },
  purple: { fill: "#c8dbe2", darkFill: "#0b4f66", underline: "#073b4c" },
  orange: { fill: "#fde2d8", darkFill: "#8a3c22", underline: "#f78c6b" },
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

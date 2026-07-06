/**
 * Shell layout state — side panes and viewer tabs — persisted across launches.
 * The browser tab is a pinned singleton ("browser"); reader tabs are article
 * card ids in tab order.
 */
export interface ViewerLayout {
  open: boolean;
  /** Pane width in px (the whiteboard takes the rest). */
  width: number;
  sidebarOpen: boolean;
  /** Article card ids with an open reader tab, in strip order. */
  readerTabs: string[];
  /** "browser" or one of readerTabs. */
  activeTab: string;
}

export const SIDEBAR_W = 264;
export const DIVIDER_W = 6;
export const MIN_VIEWER_W = 320;
export const MIN_MAIN_W = 360;

export const BROWSER_TAB = "browser";

const KEY = "octobase.viewer.layout";
export const DEFAULT_VIEWER_LAYOUT: ViewerLayout = {
  open: true,
  width: 560,
  sidebarOpen: true,
  readerTabs: [],
  activeTab: BROWSER_TAB,
};

/** Keep the pane wide enough to use and never let it squeeze out the board. */
export function clampViewerWidth(desired: number, windowWidth: number): number {
  const max = windowWidth - SIDEBAR_W - DIVIDER_W - MIN_MAIN_W;
  if (max < MIN_VIEWER_W) return MIN_VIEWER_W;
  return Math.min(Math.max(desired, MIN_VIEWER_W), max);
}

/** Width for a 50/50 board/viewer split (divider double-click). */
export function halfViewerWidth(windowWidth: number): number {
  return clampViewerWidth(Math.floor((windowWidth - SIDEBAR_W - DIVIDER_W) / 2), windowWidth);
}

/**
 * Coerce a persisted (possibly v1 or corrupted) record into a valid layout:
 * defaults filled, dead reader tabs dropped, activeTab always resolvable.
 */
export function sanitizeLayout(
  raw: unknown,
  cardExists: (id: string) => boolean,
): ViewerLayout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEWER_LAYOUT;
  const readerTabs = Array.isArray(r.readerTabs)
    ? r.readerTabs.filter((t): t is string => typeof t === "string" && cardExists(t))
    : [];
  const activeTab =
    typeof r.activeTab === "string" &&
    (r.activeTab === BROWSER_TAB || readerTabs.includes(r.activeTab))
      ? r.activeTab
      : BROWSER_TAB;
  return {
    open: typeof r.open === "boolean" ? r.open : d.open,
    width: typeof r.width === "number" && Number.isFinite(r.width) ? r.width : d.width,
    sidebarOpen: typeof r.sidebarOpen === "boolean" ? r.sidebarOpen : d.sidebarOpen,
    readerTabs,
    activeTab,
  };
}

export function loadViewerLayout(cardExists: (id: string) => boolean): ViewerLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeLayout(JSON.parse(raw), cardExists);
  } catch { /* corrupted or unavailable — fall through */ }
  return DEFAULT_VIEWER_LAYOUT;
}

export function saveViewerLayout(layout: ViewerLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch { /* storage unavailable — layout just won't persist */ }
}

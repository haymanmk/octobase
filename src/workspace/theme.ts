/**
 * Theme preference: "system" follows the OS appearance; "light"/"dark" pin
 * it. The resolved theme lands as `data-theme` on <html>, which the token
 * blocks in workspace.css key off ([data-theme="dark"]).
 */

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "octobase.theme";

/** Unknown/legacy stored values fall back to following the system. */
export function normalizeThemePref(value: string | null): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

export function loadThemePref(): ThemePref {
  if (typeof localStorage === "undefined") return "system";
  return normalizeThemePref(localStorage.getItem(STORAGE_KEY));
}

export function saveThemePref(pref: ThemePref): void {
  if (typeof localStorage === "undefined") return;
  if (pref === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, pref);
}

/** Stamp the resolved theme on <html>; light is the attribute-free default. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (resolved === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeThemePref, resolveTheme } from "../src/workspace/theme.ts";

test("explicit prefs resolve to themselves regardless of the system", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
});

test("system pref follows the OS appearance", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("unknown stored values normalize to system", () => {
  assert.equal(normalizeThemePref("dark"), "dark");
  assert.equal(normalizeThemePref("light"), "light");
  assert.equal(normalizeThemePref("system"), "system");
  assert.equal(normalizeThemePref("solarized"), "system");
  assert.equal(normalizeThemePref(null), "system");
});

import assert from "node:assert/strict";
import test from "node:test";

import { PALETTE, classNameFor, paletteCss } from "../src/components/highlighter/colors.ts";

test("palette has the six declared colors with fill and underline values", () => {
  assert.deepEqual(
    Object.keys(PALETTE).sort(),
    ["blue", "green", "orange", "pink", "purple", "yellow"],
  );
  for (const entry of Object.values(PALETTE)) {
    assert.match(entry.fill, /^#[0-9a-f]{6}$/i);
    assert.match(entry.underline, /^#[0-9a-f]{6}$/i);
  }
});

test("classNameFor returns the expected class per color", () => {
  assert.equal(classNameFor("yellow"), "octo-hl-yellow");
  assert.equal(classNameFor("orange"), "octo-hl-orange");
});

test("paletteCss includes a rule for every color with fill and underline", () => {
  const css = paletteCss();
  for (const color of Object.keys(PALETTE)) {
    assert.match(css, new RegExp(`\\.octo-hl-${color}\\b`));
  }
  for (const entry of Object.values(PALETTE)) {
    assert.ok(css.includes(entry.fill), `expected fill ${entry.fill} in css`);
    assert.ok(css.includes(entry.underline), `expected underline ${entry.underline} in css`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  PALETTE,
  ON_DARK_CLASS,
  classNameFor,
  isLightTextColor,
  paletteCss,
} from "../src/components/highlighter/colors.ts";

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

test("every color carries a darkFill for light-on-dark pages", () => {
  for (const entry of Object.values(PALETTE)) {
    assert.match(entry.darkFill, /^#[0-9a-f]{6}$/i);
    assert.notEqual(entry.darkFill, entry.fill);
  }
});

test("isLightTextColor detects light text from computed CSS colors", () => {
  assert.equal(isLightTextColor("rgb(255, 255, 255)"), true);
  assert.equal(isLightTextColor("rgb(230, 232, 235)"), true); // near-white grey
  assert.equal(isLightTextColor("rgba(255, 255, 255, 0.9)"), true);
  assert.equal(isLightTextColor("rgb(0, 0, 0)"), false);
  assert.equal(isLightTextColor("rgb(31, 33, 38)"), false); // dark ink
  assert.equal(isLightTextColor("rgb(37, 99, 235)"), false); // saturated blue
  // Unknown/unparsable input keeps the default (light-page) styling.
  assert.equal(isLightTextColor("currentcolor"), false);
  assert.equal(isLightTextColor(""), false);
});

test("paletteCss emits on-dark overrides using each color's darkFill", () => {
  const css = paletteCss();
  for (const [color, entry] of Object.entries(PALETTE)) {
    assert.match(css, new RegExp(`\\.octo-hl-${color}\\.${ON_DARK_CLASS}\\b`));
    assert.ok(css.includes(entry.darkFill), `expected darkFill ${entry.darkFill} in css`);
  }
});

test("paletteCss emits a marker-stroke rule for every color with its fill", () => {
  const css = paletteCss();
  for (const color of Object.keys(PALETTE)) {
    assert.match(css, new RegExp(`\\.octo-hl-${color}\\b`));
  }
  for (const entry of Object.values(PALETTE)) {
    assert.ok(css.includes(entry.fill), `expected fill ${entry.fill} in css`);
  }
  assert.match(css, /linear-gradient/);
  assert.match(css, /box-decoration-break:\s*clone/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { pillCss, popoverCss, SWATCH_SIZE } from "../src/components/highlighter/toolbar-ui.ts";

// The pill is the canonical highlighter look shared by the live-browser
// widget, the extension, and the reader — lock its signature values.
test("pill css carries the canonical white-pill signature", () => {
  const css = pillCss();
  assert.match(css, /\.octo-pill/);
  assert.match(css, /border-radius: 24px/);
  assert.match(css, /0 4px 14px rgba\(0,0,0,0\.12\)/);
  assert.match(css, new RegExp(`width: ${SWATCH_SIZE}px; height: ${SWATCH_SIZE}px`));
  assert.match(css, /octo-swatch-pulse/);
});

test("popover css styles the shared edit form pieces", () => {
  const css = popoverCss();
  for (const cls of ["octo-pop ", "octo-pop-row", "octo-pop-input", "octo-pop-delete", "octo-pop-primary"]) {
    assert.ok(css.includes(cls), `missing ${cls}`);
  }
});

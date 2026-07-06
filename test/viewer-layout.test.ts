import assert from "node:assert/strict";
import test from "node:test";

import {
  clampViewerWidth,
  halfViewerWidth,
  sanitizeLayout,
  DEFAULT_VIEWER_LAYOUT,
  MIN_VIEWER_W,
  SIDEBAR_W,
  DIVIDER_W,
  MIN_MAIN_W,
} from "../src/workspace/viewer-layout.ts";

test("width stays within [min viewer, window minus sidebar+divider+min main]", () => {
  const win = 1440;
  const max = win - SIDEBAR_W - DIVIDER_W - MIN_MAIN_W;
  assert.equal(clampViewerWidth(560, win), 560);
  assert.equal(clampViewerWidth(50, win), MIN_VIEWER_W);
  assert.equal(clampViewerWidth(5000, win), max);
});

test("tiny windows fall back to the viewer floor", () => {
  assert.equal(clampViewerWidth(560, 700), MIN_VIEWER_W);
});

test("half width splits the space left of the sidebar", () => {
  const win = 1440;
  const half = Math.floor((win - SIDEBAR_W - DIVIDER_W) / 2);
  assert.equal(halfViewerWidth(win), clampViewerWidth(half, win));
});

test("sanitizeLayout fills defaults from a v1 record (no tabs fields)", () => {
  const l = sanitizeLayout({ open: false, width: 400 }, () => true);
  assert.equal(l.open, false);
  assert.equal(l.width, 400);
  assert.equal(l.sidebarOpen, DEFAULT_VIEWER_LAYOUT.sidebarOpen);
  assert.deepEqual(l.readerTabs, []);
  assert.equal(l.activeTab, "browser");
});

test("sanitizeLayout drops reader tabs whose card is gone and fixes activeTab", () => {
  const live = new Set(["card-a", "card-c"]);
  const l = sanitizeLayout(
    { readerTabs: ["card-a", "card-b", "card-c"], activeTab: "card-b" },
    (id) => live.has(id),
  );
  assert.deepEqual(l.readerTabs, ["card-a", "card-c"]);
  assert.equal(l.activeTab, "browser"); // card-b vanished
});

test("sanitizeLayout keeps a valid activeTab", () => {
  const l = sanitizeLayout(
    { readerTabs: ["card-a"], activeTab: "card-a" },
    () => true,
  );
  assert.equal(l.activeTab, "card-a");
});

test("sanitizeLayout tolerates garbage", () => {
  const l = sanitizeLayout(
    { readerTabs: "nope", activeTab: 42, width: "wide", open: 1, sidebarOpen: "x" },
    () => true,
  );
  assert.deepEqual(l.readerTabs, []);
  assert.equal(l.activeTab, "browser");
  assert.equal(typeof l.width, "number");
  assert.equal(typeof l.open, "boolean");
  assert.equal(typeof l.sidebarOpen, "boolean");
});

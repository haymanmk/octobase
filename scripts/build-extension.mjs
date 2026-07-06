// Bundle the MV3 capture extension from src/extension into dist-extension/.
// Content script + popup are IIFE; the service worker is an ES module so it can
// keep using top-level imports. Shares src/lib (anchor + extractor) directly.

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/extension");
const out = path.join(root, "dist-extension");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  platform: "browser",
  target: "chrome114",
  legalComments: "none",
  logLevel: "info",
};

// Content script + popup run as classic scripts → IIFE.
await build({
  ...common,
  entryPoints: [path.join(src, "content.ts"), path.join(src, "popup.ts")],
  outdir: out,
  format: "iife",
});

// Service worker is declared without "type":"module", so bundle it as IIFE too.
await build({
  ...common,
  entryPoints: [path.join(src, "background.ts")],
  outdir: out,
  format: "iife",
});

await cp(path.join(src, "manifest.json"), path.join(out, "manifest.json"));
await cp(path.join(src, "popup.html"), path.join(out, "popup.html"));

console.log(`\nExtension built → ${path.relative(root, out)}/  (Load unpacked in chrome://extensions)`);

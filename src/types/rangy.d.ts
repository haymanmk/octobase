/**
 * Module augmentation to bridge the gap between rangy's ES module export
 * (rangy-core.d.ts) and the highlighter plugin, which only augments the
 * global `rangy` namespace rather than the module export.
 *
 * `rangy-highlighter.d.ts` declares `createHighlighter` inside
 * `declare global { namespace rangy { ... } }`, so it is only reachable via
 * the global namespace — not via `import rangy from 'rangy'`.
 *
 * The import below loads the global namespace augmentation so that
 * `globalThis.rangy.RangyHighlighter` is resolvable in the declaration below.
 */
import 'rangy/lib/rangy-highlighter';
import 'rangy/lib/rangy-classapplier';

declare module 'rangy' {
  function createHighlighter(
    doc?: Document | Window | HTMLIFrameElement,
    type?: 'textContent' | 'textRange',
  ): globalThis.rangy.RangyHighlighter;

  function createClassApplier(
    className: string,
    options?: globalThis.rangy.RangyClassApplierOptions,
    tagNames?: string[] | string,
  ): globalThis.rangy.RangyClassApplier;
}

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHighlightDragPayload,
  getOrCreateHighlightId,
  stampHighlightGroup,
} from '../src/components/highlighter/highlight-id.ts';

test('reuses the same highlight id for repeated drags of one highlighted element', () => {
  const element = { dataset: {} as Record<string, string> };
  let generatedIds = 0;

  const firstId = getOrCreateHighlightId(element, () => {
    generatedIds += 1;
    return 'hl-stable';
  });
  const secondId = getOrCreateHighlightId(element, () => {
    generatedIds += 1;
    return 'hl-duplicate';
  });

  assert.equal(firstId, 'hl-stable');
  assert.equal(secondId, 'hl-stable');
  assert.equal(generatedIds, 1);
});

test('stamps every fragment in one selection with shared drag metadata', () => {
  const fragments = [
    { dataset: {}, textContent: 'Read ' },
    { dataset: {}, textContent: 'docs' },
  ];

  stampHighlightGroup(fragments, 'Read docs', () => 'hl-group');

  assert.equal(fragments[0].dataset.octobaseHighlightId, 'hl-group');
  assert.equal(fragments[1].dataset.octobaseHighlightId, 'hl-group');
  assert.equal(fragments[0].dataset.octobaseHighlightText, 'Read docs');
  assert.equal(fragments[1].dataset.octobaseHighlightText, 'Read docs');
});

test('drag payload uses grouped text instead of fragment text', () => {
  const fragment = {
    dataset: {
      octobaseHighlightId: 'hl-group',
      octobaseHighlightText: 'Read docs',
    },
    textContent: 'docs',
  };

  assert.deepEqual(getHighlightDragPayload(fragment), {
    highlightId: 'hl-group',
    text: 'Read docs',
  });
});

import { expect, test } from 'vitest';

import { deriveViewState } from './derive-view-state';

test.each([
  ['loading without cached data', 'loading', 0, false, 'loading'],
  ['loading with cached data', 'loading', 2, false, 'ready'],
  ['loading with no filter match', 'loading', 2, true, 'no-match'],
  ['bd unavailable without cached data', 'bd-unavailable', 0, false, 'bd-unavailable'],
  [
    'bd unavailable error takes precedence over no-match',
    'bd-unavailable',
    0,
    true,
    'bd-unavailable',
  ],
  ['bd unavailable with cached data', 'bd-unavailable', 2, false, 'ready'],
  ['bd unavailable with no filter match', 'bd-unavailable', 2, true, 'no-match'],
  ['an empty workspace takes precedence over no-match', 'healthy', 0, true, 'empty'],
  ['a filtered view with no match', 'healthy', 2, true, 'no-match'],
  ['a populated view without no-match', 'journal-disabled', 2, false, 'ready'],
] as const)('%s', (_name, syncKind, total, noMatch, expected) => {
  expect(deriveViewState({ syncKind, total, noMatch })).toBe(expected);
});

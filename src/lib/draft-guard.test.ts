import { expect, test } from 'vitest';

import { confirmLeaveDraft, setDraftGuard } from './draft-guard';

test('leaving is allowed when no draft is open', () => {
  expect(confirmLeaveDraft()).toBe(true);
});

test('a registered guard decides whether navigation may proceed', () => {
  setDraftGuard(() => false);
  expect(confirmLeaveDraft()).toBe(false);

  setDraftGuard(() => true);
  expect(confirmLeaveDraft()).toBe(true);

  setDraftGuard(null);
  expect(confirmLeaveDraft()).toBe(true);
});

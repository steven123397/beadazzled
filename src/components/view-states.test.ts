import { expect, test } from 'vitest';

import { issuePath } from './view-states';

test.each([
  { issueId: 'bza/1', encoded: 'bza%2F1' },
  { issueId: 'bza 1', encoded: 'bza%201' },
  { issueId: '工单/一', encoded: '%E5%B7%A5%E5%8D%95%2F%E4%B8%80' },
  { issueId: 'bza#1/?', encoded: 'bza%231%2F%3F' },
])('issuePath encodes $issueId as one route segment', ({ issueId, encoded }) => {
  expect(issuePath('p1', issueId)).toBe(`/w/p1/issue/${encoded}`);
});

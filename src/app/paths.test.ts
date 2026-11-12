import { describe, expect, it } from 'vitest';
import { boardPath, isIssuePath, issuePath, listPath } from './paths';

describe('paths', () => {
  it('constructs list and board paths', () => {
    expect(listPath('proj-123')).toBe('/w/proj-123/list');
    expect(boardPath('proj-123')).toBe('/w/proj-123/board');
  });

  it.each([
    { issueId: 'bza/1', encoded: 'bza%2F1' },
    { issueId: 'bza 1', encoded: 'bza%201' },
    { issueId: '工单/一', encoded: '%E5%B7%A5%E5%8D%95%2F%E4%B8%80' },
    { issueId: 'bza#1/?', encoded: 'bza%231%2F%3F' },
  ])('issuePath encodes $issueId as one route segment', ({ issueId, encoded }) => {
    expect(issuePath('p1', issueId)).toBe(`/w/p1/issue/${encoded}`);
  });

  it('identifies issue routes correctly', () => {
    expect(isIssuePath('/w/proj-123/issue/bza-1')).toBe(true);
    expect(isIssuePath('/w/proj-123/issue/bza%2F1')).toBe(true);
    expect(isIssuePath('/w/proj-123/list')).toBe(false);
    expect(isIssuePath('/w/proj-123/board')).toBe(false);
    expect(isIssuePath('/settings')).toBe(false);
  });
});

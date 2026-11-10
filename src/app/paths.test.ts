import { describe, expect, it } from 'vitest';
import { boardPath, isIssuePath, listPath } from './paths';

describe('paths', () => {
  it('constructs list and board paths', () => {
    expect(listPath('proj-123')).toBe('/w/proj-123/list');
    expect(boardPath('proj-123')).toBe('/w/proj-123/board');
  });

  it('identifies issue routes correctly', () => {
    expect(isIssuePath('/w/proj-123/issue/bza-1')).toBe(true);
    expect(isIssuePath('/w/proj-123/issue/bza%2F1')).toBe(true);
    expect(isIssuePath('/w/proj-123/list')).toBe(false);
    expect(isIssuePath('/w/proj-123/board')).toBe(false);
    expect(isIssuePath('/settings')).toBe(false);
  });
});

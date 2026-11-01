import { expect, test } from 'vitest';

import tokensCss from '@/styles/tokens.css?raw';

import { contrastRatio } from './contrast';

function block(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`);
  expect(start, `missing ${selector}`).toBeGreaterThanOrEqual(0);
  const end = tokensCss.indexOf('}', start);
  const values: Record<string, string> = {};
  for (const line of tokensCss.slice(start, end).split('\n')) {
    const match = /--([\w-]+):\s*(#[0-9a-fA-F]{3,8});/.exec(line);
    if (match) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

test('contrastRatio matches WCAG extremes', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 0);
});

test('body text meets 4.5:1 in both themes', () => {
  for (const selector of [':root', '.dark']) {
    const tokens = block(selector);
    expect(
      contrastRatio(tokens.foreground, tokens.background),
      `${selector} foreground on background`
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(tokens.foreground, tokens.card),
      `${selector} foreground on card`
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test('secondary text still meets 4.5:1 in both themes', () => {
  for (const selector of [':root', '.dark']) {
    const tokens = block(selector);
    expect(
      contrastRatio(tokens['muted-foreground'], tokens.background),
      `${selector} muted foreground`
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test('error text meets 4.5:1 in both themes', () => {
  for (const selector of [':root', '.dark']) {
    const tokens = block(selector);
    expect(
      contrastRatio(tokens.destructive, tokens.background),
      `${selector} destructive`
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test('primary button text stays readable', () => {
  const tokens = block(':root');
  expect(contrastRatio(tokens['primary-foreground'], tokens.primary)).toBeGreaterThanOrEqual(4.5);
});

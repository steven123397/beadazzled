import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithI18n } from '@/test/fixtures';

import { Markdown } from './Markdown';

function renderMarkdown(ui: React.ReactElement) {
  return renderWithI18n(ui);
}

test('GFM tables, task lists, strikethrough, code and nested lists all render', () => {
  const source = [
    '| Name | State |',
    '| --- | --- |',
    '| beta | open |',
    '',
    '- [x] shipped',
    '- [ ] pending',
    '',
    '~~struck~~',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '- outer',
    '  - inner',
  ].join('\n');

  const { container } = renderMarkdown(<Markdown>{source}</Markdown>);

  expect(container.querySelector('table th')?.textContent).toBe('Name');
  expect(screen.getByRole('checkbox', { name: 'Completed task' })).toBeChecked();
  expect(container.querySelector('del')?.textContent).toBe('struck');
  expect(container.querySelector('pre code')?.textContent).toContain('const answer = 42;');
  expect(container.querySelectorAll('ul ul li')).toHaveLength(1);
});

test('script, iframe, event handlers and javascript links never become executable', () => {
  const source = [
    '<script>window.__pwned = true;</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<img src="x" onerror="window.__pwned = true">',
    '[click me](javascript:window.__pwned=true)',
  ].join('\n\n');

  const { container } = renderMarkdown(<Markdown>{source}</Markdown>);

  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[onerror]')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
});

test('a remote image becomes a placeholder holding its address instead of a request', () => {
  const onOpenLink = vi.fn();
  const { container } = renderMarkdown(
    <Markdown onOpenLink={onOpenLink}>{'![diagram](https://example.com/pic.png)'}</Markdown>
  );

  expect(container.querySelector('img')).toBeNull();
  const address = screen.getByRole('link', { name: 'https://example.com/pic.png' });

  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  address.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(onOpenLink).toHaveBeenCalledWith('https://example.com/pic.png');
});

test('an http link opens through the system browser and does not navigate the app', () => {
  const onOpenLink = vi.fn();
  renderMarkdown(<Markdown onOpenLink={onOpenLink}>{'[docs](https://example.com/docs)'}</Markdown>);

  const link = screen.getByRole('link', { name: 'docs' });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);

  expect(onOpenLink).toHaveBeenCalledWith('https://example.com/docs');
  expect(event.defaultPrevented).toBe(true);
});

test('a relative link is plain text and cannot trigger in-app navigation', () => {
  renderMarkdown(<Markdown>{'[local](./other.md)'}</Markdown>);

  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('local')).toBeInTheDocument();
});

test('bare URLs autolink as external links', () => {
  renderMarkdown(<Markdown>{'see https://example.com for details'}</Markdown>);

  expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument();
});

test('empty content renders an empty container', () => {
  const { container } = renderMarkdown(<Markdown>{''}</Markdown>);

  expect(container.firstElementChild).toBeEmptyDOMElement();
});

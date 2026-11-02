import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { GroupHeader } from './GroupHeader';

function renderHeader({
  group = 'status' as const,
  groupKey = 'open',
  count = 3,
  collapsed = false,
}: {
  group?: 'status' | 'priority' | 'type' | 'assignee';
  groupKey?: string;
  count?: number;
  collapsed?: boolean;
} = {}) {
  const onToggle = vi.fn();
  render(
    <I18nProvider initialLanguage="en">
      <GroupHeader
        group={group}
        groupKey={groupKey}
        count={count}
        collapsed={collapsed}
        start={72}
        onToggle={onToggle}
      />
    </I18nProvider>
  );
  return { onToggle };
}

test('a status group translates its key and shows the count', () => {
  renderHeader({ group: 'status', groupKey: 'in_progress', count: 4 });

  expect(screen.getByRole('listitem')).toHaveTextContent('In progress');
  expect(screen.getByRole('listitem')).toHaveTextContent('4');
  expect(screen.getByRole('button', { name: /In progress/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

test('priority, type and assignee groups use their raw keys', () => {
  const { onToggle } = renderHeader({ group: 'priority', groupKey: '0', count: 1 });
  expect(screen.getByRole('button', { name: /P0/ })).toBeInTheDocument();

  renderHeader({ group: 'type', groupKey: 'bug', count: 2 });
  expect(screen.getAllByRole('button', { name: /bug/ }).length).toBeGreaterThan(0);

  renderHeader({ group: 'assignee', groupKey: '', count: 5 });
  expect(screen.getAllByRole('button', { name: /Unassigned/ }).length).toBeGreaterThan(0);

  fireEvent.click(screen.getAllByRole('button', { name: /P0/ })[0]!);
  expect(onToggle).toHaveBeenCalledWith('0');
});

test('a collapsed group reports aria-expanded false', () => {
  renderHeader({ collapsed: true });

  expect(screen.getByRole('button', { name: /Open/ })).toHaveAttribute('aria-expanded', 'false');
});

test('the header is positioned at the virtualizer offset', () => {
  renderHeader();

  expect(screen.getByRole('listitem')).toHaveStyle({ transform: 'translateY(72px)' });
});

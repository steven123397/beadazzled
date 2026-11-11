import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithI18n } from '@/test/fixtures';

import { Comments } from './Comments';

function renderComments(props: Partial<Parameters<typeof Comments>[0]> = {}) {
  const onSubmit = vi.fn(async () => true);
  renderWithI18n(<Comments onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

test('the comment button submits the draft and clears it after success', async () => {
  const { onSubmit } = renderComments();

  fireEvent.change(screen.getByRole('textbox', { name: 'Write a comment…' }), {
    target: { value: 'Looks good' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

  expect(onSubmit).toHaveBeenCalledWith('Looks good');
  await vi.waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Write a comment…' })).toHaveValue('')
  );
});

test('Ctrl+Enter submits without the button', () => {
  const { onSubmit } = renderComments();

  const input = screen.getByRole('textbox', { name: 'Write a comment…' });
  fireEvent.change(input, { target: { value: 'From the keyboard' } });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

  expect(onSubmit).toHaveBeenCalledWith('From the keyboard');
});

test('a failed comment keeps the text and shows the error', async () => {
  const onSubmit = vi.fn(async () => false);
  renderComments({ onSubmit, error: 'bd timed out' });

  const input = screen.getByRole('textbox', { name: 'Write a comment…' });
  fireEvent.change(input, { target: { value: 'Do not lose me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('alert')).toHaveTextContent('bd timed out');
  expect(input).toHaveValue('Do not lose me');
});

test('each comment is stamped with a machine-readable time', () => {
  renderComments({
    comments: [
      {
        id: 'c1',
        issue_id: 'bza-b',
        author: 'ada',
        text: 'First thought',
        created_at: '2026-11-01T01:00:00Z',
      },
    ],
  });

  const time = document.querySelector('time');
  expect(time).toHaveAttribute('datetime', '2026-11-01T01:00:00Z');
  expect(time?.getAttribute('title')).toBeTruthy();
});

test('an empty draft cannot be submitted', () => {
  const { onSubmit } = renderComments();

  expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('without a write callback there is no composer', () => {
  renderWithI18n(<Comments comments={[]} />);

  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});

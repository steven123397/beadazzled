import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { Comments } from './Comments';

function renderComments(props: Partial<Parameters<typeof Comments>[0]> = {}) {
  const onSubmit = vi.fn(async () => true);
  render(
    <I18nProvider initialLanguage="en">
      <Comments onSubmit={onSubmit} {...props} />
    </I18nProvider>
  );
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

test('an empty draft cannot be submitted', () => {
  const { onSubmit } = renderComments();

  expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('without a write callback there is no composer', () => {
  render(
    <I18nProvider initialLanguage="en">
      <Comments comments={[]} />
    </I18nProvider>
  );

  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});
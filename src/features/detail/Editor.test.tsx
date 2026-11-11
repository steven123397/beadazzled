import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithI18n } from '@/test/fixtures';

import { Editor } from './Editor';

function renderEditor(props: Partial<Parameters<typeof Editor>[0]> = {}) {
  const onSave = vi.fn(async () => true);
  const onCancel = vi.fn();
  renderWithI18n(
    <Editor label="Title" value="Original title" onSave={onSave} onCancel={onCancel} {...props} />
  );
  return { onSave, onCancel };
}

test('saving passes the edited value and leaves the editor open for the parent', async () => {
  const { onSave } = renderEditor();

  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(onSave).toHaveBeenCalledWith('New title');
  await screen.findByRole('textbox', { name: 'Title' });
});

test('cancel drops the draft without calling save', () => {
  const { onSave, onCancel } = renderEditor();

  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Discarded' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

test('a failed save keeps the draft and shows the error', async () => {
  const onSave = vi.fn(async () => false);
  renderEditor({ onSave, error: 'bd timed out' });

  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Still here' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(screen.getByText('bd timed out')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Still here');
});

test('escape cancels the edit and does not reach the global shortcut handler', () => {
  const { onCancel } = renderEditor();
  const globalKeydown = vi.fn();
  window.addEventListener('keydown', globalKeydown);

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(globalKeydown).not.toHaveBeenCalled();
  window.removeEventListener('keydown', globalKeydown);
});

test('a multiline editor saves with Ctrl+Enter and previews markdown', () => {
  const { onSave } = renderEditor({
    label: 'Description',
    multiline: true,
    previewable: true,
    value: 'Some **bold** text',
  });

  const textbox = screen.getByRole('textbox', { name: 'Description' });
  fireEvent.change(textbox, { target: { value: 'Some **bold** text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

  expect(screen.getByText('bold').tagName).toBe('STRONG');

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Description' }), {
    key: 'Enter',
    ctrlKey: true,
  });

  expect(onSave).toHaveBeenCalledWith('Some **bold** text');
});

test('a pending write disables the controls and says it is saving', () => {
  renderEditor({ pending: true });

  expect(screen.getByRole('textbox', { name: 'Title' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
});

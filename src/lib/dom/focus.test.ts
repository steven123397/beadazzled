import { expect, test } from 'vitest';

import { isEditableTarget, isOverlayOpen, isViewTarget } from './focus';

test('editable targets are inputs, textareas and contenteditable hosts', () => {
  expect(isEditableTarget(document.createElement('input'))).toBe(true);
  expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
  expect(isEditableTarget(document.createElement('select'))).toBe(true);

  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  expect(isEditableTarget(host)).toBe(true);

  const child = document.createElement('span');
  host.append(child);
  expect(isEditableTarget(child)).toBe(true);

  const locked = document.createElement('span');
  locked.setAttribute('contenteditable', 'false');
  host.append(locked);
  expect(isEditableTarget(locked)).toBe(false);

  // A summary replaces the native select in dropdowns; it owns single keys.
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const summaryChild = document.createElement('span');
  summary.append(summaryChild);
  details.append(summary);
  document.body.append(details);
  expect(isEditableTarget(summary)).toBe(true);
  expect(isEditableTarget(summaryChild)).toBe(true);
  details.remove();

  expect(isEditableTarget(document.createElement('button'))).toBe(false);
  expect(isEditableTarget(null)).toBe(false);
});

test('an open modal is detected until it leaves the document', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);

  expect(isOverlayOpen()).toBe(true);
  dialog.remove();
  expect(isOverlayOpen()).toBe(false);
});

test('view targets include the view and ticket rows but not outside controls', () => {
  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  const row = document.createElement('div');
  row.setAttribute('data-issue-id', 'bza-1');
  const outside = document.createElement('button');

  expect(isViewTarget(window)).toBe(true);
  expect(isViewTarget(document)).toBe(true);
  expect(isViewTarget(document.body)).toBe(true);
  expect(isViewTarget(list)).toBe(true);
  expect(isViewTarget(row)).toBe(true);
  expect(isViewTarget(outside)).toBe(false);
  expect(isViewTarget(null)).toBe(false);
});

test('a Window that is not identical to the global is still a view target', () => {
  const foreignWindow = Object.create(Window.prototype) as Window;

  expect(foreignWindow).not.toBe(window);
  expect(isViewTarget(foreignWindow)).toBe(true);
});

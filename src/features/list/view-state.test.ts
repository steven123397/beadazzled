import { expect, test } from 'vitest';

import {
  createListViewState,
  parseListViewState,
  serializeListViewState,
  type ListViewState,
} from './view-state';

test('a fresh view state has no filters, no grouping and newest-updated sorting', () => {
  expect(createListViewState()).toEqual({
    filter: {
      query: '',
      status: [],
      priority: [],
      type: [],
      assignee: [],
      label: [],
      ready: false,
    },
    group: 'none',
    sort: { by: 'updated', direction: 'desc' },
  });
});

test('two fresh states do not share their filter arrays', () => {
  const first = createListViewState();
  const second = createListViewState();

  first.filter.status.push('open');

  expect(second.filter.status).toEqual([]);
});

test('parses every supported query parameter', () => {
  const params = new URLSearchParams();
  params.append('q', 'Scroll');
  params.append('status', 'open');
  params.append('status', 'in_progress');
  params.append('priority', '0');
  params.append('priority', '2');
  params.append('type', 'bug');
  params.append('assignee', 'ada');
  params.append('assignee', '');
  params.append('label', 'ui');
  params.set('group', 'priority');
  params.set('sort', 'title:asc');
  params.set('ready', '1');

  expect(parseListViewState(params)).toEqual({
    filter: {
      query: 'Scroll',
      status: ['open', 'in_progress'],
      priority: [0, 2],
      type: ['bug'],
      assignee: ['ada', ''],
      label: ['ui'],
      ready: true,
    },
    group: 'priority',
    sort: { by: 'title', direction: 'asc' },
  });
});

test('an empty URL parses to the default view state', () => {
  expect(parseListViewState(new URLSearchParams())).toEqual(createListViewState());
});

test('a bare sort field uses that field default direction', () => {
  const cases: Array<[string, ListViewState['sort']]> = [
    ['updated', { by: 'updated', direction: 'desc' }],
    ['-updated', { by: 'updated', direction: 'asc' }],
    ['priority', { by: 'priority', direction: 'asc' }],
    ['-priority', { by: 'priority', direction: 'desc' }],
    ['created', { by: 'created', direction: 'desc' }],
    ['-created', { by: 'created', direction: 'asc' }],
    ['title', { by: 'title', direction: 'asc' }],
    ['-title', { by: 'title', direction: 'desc' }],
    ['id', { by: 'id', direction: 'asc' }],
    ['-id', { by: 'id', direction: 'desc' }],
  ];

  for (const [value, expected] of cases) {
    const params = new URLSearchParams({ sort: value });
    expect(parseListViewState(params).sort).toEqual(expected);
  }
});

test('unknown group, sort and priority values fall back safely', () => {
  const params = new URLSearchParams({
    group: 'unknown',
    sort: 'unknown',
    priority: '9',
  });
  params.append('priority', 'not-a-number');

  const view = parseListViewState(params);

  expect(view.group).toBe('none');
  expect(view.sort).toEqual({ by: 'updated', direction: 'desc' });
  expect(view.filter.priority).toEqual([]);
});

test('empty multi-select values are ignored except for the unassigned assignee', () => {
  const params = new URLSearchParams();
  params.append('status', '');
  params.append('type', '');
  params.append('label', '');
  params.append('assignee', '');

  const view = parseListViewState(params);

  expect(view.filter.status).toEqual([]);
  expect(view.filter.type).toEqual([]);
  expect(view.filter.label).toEqual([]);
  expect(view.filter.assignee).toEqual(['']);
});

test('the default view serializes to an empty query string', () => {
  expect(serializeListViewState(createListViewState()).toString()).toBe('');
});

test('serializes filters, grouping, sorting and ready into fixed keys', () => {
  const view: ListViewState = {
    filter: {
      query: 'Scroll',
      status: ['open', 'in_progress'],
      priority: [0, 2],
      type: ['bug'],
      assignee: ['ada', ''],
      label: ['ui'],
      ready: true,
    },
    group: 'priority',
    sort: { by: 'title', direction: 'asc' },
  };

  const params = serializeListViewState(view);

  expect(params.get('q')).toBe('Scroll');
  expect(params.getAll('status')).toEqual(['open', 'in_progress']);
  expect(params.getAll('priority')).toEqual(['0', '2']);
  expect(params.getAll('type')).toEqual(['bug']);
  expect(params.getAll('assignee')).toEqual(['ada', '']);
  expect(params.getAll('label')).toEqual(['ui']);
  expect(params.get('group')).toBe('priority');
  expect(params.get('sort')).toBe('title:asc');
  expect(params.get('ready')).toBe('1');
});

test('round trips a non-default view state through the URL', () => {
  const view: ListViewState = {
    filter: {
      query: 'list',
      status: ['closed'],
      priority: [1],
      type: ['task'],
      assignee: ['lin'],
      label: ['backend'],
      ready: true,
    },
    group: 'assignee',
    sort: { by: 'created', direction: 'asc' },
  };

  expect(parseListViewState(serializeListViewState(view))).toEqual(view);
});

test('unknown query keys survive serialization', () => {
  const base = new URLSearchParams('view=tree&q=old&status=closed');

  const params = serializeListViewState(createListViewState(), base);

  expect(params.get('view')).toBe('tree');
  expect(params.get('q')).toBeNull();
  expect(params.getAll('status')).toEqual([]);
});

test('the default sort is omitted but an explicit direction is kept', () => {
  const view = createListViewState();
  view.sort = { by: 'updated', direction: 'asc' };

  expect(serializeListViewState(view).get('sort')).toBe('updated:asc');

  view.sort = { by: 'priority', direction: 'asc' };
  expect(serializeListViewState(view).get('sort')).toBe('priority:asc');
});

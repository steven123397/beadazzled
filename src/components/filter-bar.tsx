import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Issue } from '@/bindings/bd';
import { isEditableTarget, isOverlayOpen } from '@/app/keyboard/resolve';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PopoverSelect } from '@/components/ui/popover-select';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { collator } from '@/lib/view/collator';
import { hasActiveFilters } from '@/lib/view/filter';
import { STATUS_ORDER, statusText } from '@/lib/status';
import {
  DEFAULT_SORT_DIRECTION,
  GROUP_VALUES,
  SORT_FIELDS,
  type GroupBy,
  type ListFilter,
  type ListViewState,
  type SortField,
} from '@/lib/view/state';

const GROUP_LABELS: Record<GroupBy, MessageKey> = {
  none: 'list.group.none',
  status: 'list.group.status',
  priority: 'list.group.priority',
  type: 'list.group.type',
  assignee: 'list.group.assignee',
};

const SORT_LABELS: Record<SortField, MessageKey> = {
  updated: 'list.sort.updated',
  priority: 'list.sort.priority',
  created: 'list.sort.created',
  title: 'list.sort.title',
  id: 'list.sort.id',
};

export type FilterBarProps = {
  view: ListViewState;
  issues: readonly Issue[];
  visibleCount: number;
  totalCount: number;
  onChange: (view: ListViewState) => void;
  onClear: () => void;
  /**
   * Board mode hides the status, grouping and sorting controls: its columns
   * express status and its order is fixed by SPEC-board.
   */
  mode?: 'list' | 'board';
  /** Overrides the default `hasActiveFilters`; the board ignores status. */
  activeFilters?: boolean;
};

type Option = {
  value: string;
  label: string;
};

/**
 * Memoized: the list re-renders on every scroll range change, while these
 * props stay identity-stable, so scrolling does not reconcile the whole bar.
 */
export const FilterBar = memo(function FilterBar({
  view,
  issues,
  visibleCount,
  totalCount,
  onChange,
  onClear,
  mode = 'list',
  activeFilters,
}: FilterBarProps) {
  const { t } = useI18n();
  const listMode = mode === 'list';
  const filtersActive = activeFilters ?? hasActiveFilters(view.filter);
  const searchRef = useRef<HTMLInputElement>(null);
  // The input is driven by this draft, not by the URL: every keystroke would
  // otherwise round-trip through router state, and a character typed during
  // that round trip gets reset out of the field.
  const [draftQuery, setDraftQuery] = useState(view.filter.query);

  // Follow external changes (clear, a restored saved view) while the field is
  // not being typed into.
  useEffect(() => {
    if (document.activeElement !== searchRef.current) {
      setDraftQuery(view.filter.query);
    }
  }, [view.filter.query]);

  const changeQuery = (next: string) => {
    setDraftQuery(next);
    updateFilter({ query: next });
  };

  const clearAll = () => {
    setDraftQuery('');
    onClear();
  };

  // A layout effect, not a passive one: the bar paints as soon as the first
  // snapshot arrives, and "/" pressed between that paint and the effect flush
  // would be lost. A keyboard-first list must not drop the first key.
  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key !== '/' || isEditableTarget(event.target) || isOverlayOpen()) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Native `<details>` panels do not know about each other: opening the next
  // one leaves the previous open, and pressing outside leaves it stranded.
  // One document-level listener closes every panel that does not contain the
  // press, and Escape closes the focused one. The elements stay native, so a
  // summary press still toggles its own panel as usual.
  useEffect(() => {
    function closeMenus(event: Event): void {
      const escape = event instanceof KeyboardEvent && event.key === 'Escape';
      if (event instanceof KeyboardEvent && !escape) {
        return;
      }
      const target = event.target instanceof Node ? event.target : null;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        'details[data-filter-menu][open]'
      )) {
        if (!escape && target !== null && menu.contains(target)) {
          continue;
        }
        menu.open = false;
        if (escape && target !== null && menu.contains(target)) {
          menu.querySelector('summary')?.focus();
        }
      }
    }

    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeMenus);
    return () => {
      document.removeEventListener('pointerdown', closeMenus);
      document.removeEventListener('keydown', closeMenus);
    };
  }, []);

  const statusOptions = useMemo(() => {
    if (!listMode) {
      // The board hides the status control; do not build options it never shows.
      return [];
    }
    const present = new Set(issues.map((issue) => issue.status));
    const extra = [...present].filter((status) => !STATUS_ORDER.includes(status)).sort();
    return withSelected([...STATUS_ORDER, ...extra], view.filter.status).map((value) => ({
      value,
      label: statusText(value, t),
    }));
  }, [issues, listMode, view.filter.status, t]);

  const priorityOptions = useMemo(
    () =>
      withSelected(['0', '1', '2', '3', '4'], view.filter.priority.map(String)).map((value) => ({
        value,
        label: `P${value}`,
      })),
    [view.filter.priority]
  );

  const typeOptions = useMemo(
    () =>
      withSelected(uniqueSorted(issues.map((issue) => issue.issue_type)), view.filter.type).map(
        (value) => ({ value, label: value })
      ),
    [issues, view.filter.type]
  );

  const assigneeOptions = useMemo(() => {
    const present = new Set(issues.map((issue) => issue.assignee ?? ''));
    const values = [...present].filter((value) => value !== '').sort(collator.compare);
    if (present.has('')) {
      values.push('');
    }
    return withSelected(values, view.filter.assignee).map((value) => ({
      value,
      label: value === '' ? t('list.unassigned') : value,
    }));
  }, [issues, view.filter.assignee, t]);

  const labelOptions = useMemo(
    () =>
      withSelected(uniqueSorted(issues.flatMap((issue) => issue.labels)), view.filter.label).map(
        (value) => ({ value, label: value })
      ),
    [issues, view.filter.label]
  );

  function updateFilter(patch: Partial<ListFilter>): void {
    onChange({ ...view, filter: { ...view.filter, ...patch } });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 border-b border-border px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          ref={searchRef}
          type="search"
          controlSize="md"
          aria-label={t('list.filter.search')}
          aria-keyshortcuts="/"
          placeholder={t('list.filter.search')}
          value={draftQuery}
          onChange={(event) => changeQuery(event.target.value)}
          className="w-44 xl:w-64"
        />
        {listMode ? (
          <MultiSelect
            label={t('list.filter.status')}
            options={statusOptions}
            selected={view.filter.status}
            onChange={(status) => updateFilter({ status })}
          />
        ) : null}
        <MultiSelect
          label={t('list.filter.priority')}
          options={priorityOptions}
          selected={view.filter.priority.map(String)}
          onChange={(priority) => updateFilter({ priority: priority.map(Number) })}
        />
        <MultiSelect
          label={t('list.filter.type')}
          options={typeOptions}
          selected={view.filter.type}
          onChange={(type) => updateFilter({ type })}
        />
        <MultiSelect
          label={t('list.filter.assignee')}
          options={assigneeOptions}
          selected={view.filter.assignee}
          onChange={(assignee) => updateFilter({ assignee })}
        />
        <MultiSelect
          label={t('list.filter.label')}
          options={labelOptions}
          selected={view.filter.label}
          onChange={(label) => updateFilter({ label })}
        />
      </div>
      <label className="ml-3 flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={view.filter.ready}
          onChange={(event) => updateFilter({ ready: event.target.checked })}
        />
        {t('list.filter.ready')}
      </label>
      {listMode ? (
        <div className="ml-3 flex items-center gap-1.5">
          <PopoverSelect
            label={t('list.filter.groupBy')}
            value={view.group}
            options={GROUP_VALUES.map((value) => ({
              value,
              label: t(GROUP_LABELS[value]),
            }))}
            onChange={(value) => onChange({ ...view, group: value as GroupBy })}
          />
          <PopoverSelect
            label={t('list.filter.sortBy')}
            value={view.sort.by}
            options={SORT_FIELDS.map((value) => ({
              value,
              label: t(SORT_LABELS[value]),
            }))}
            onChange={(value) => {
              const by = value as SortField;
              onChange({ ...view, sort: { by, direction: DEFAULT_SORT_DIRECTION[by] } });
            }}
          />
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('list.sort.reverse')}
            onClick={() =>
              onChange({
                ...view,
                sort: {
                  ...view.sort,
                  direction: view.sort.direction === 'asc' ? 'desc' : 'asc',
                },
              })
            }
            className="size-8 text-sm text-muted-foreground"
          >
            {view.sort.direction === 'asc' ? '↑' : '↓'}
          </Button>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-8 text-sm text-muted-foreground"
          >
            {t('list.filter.clear')}
          </Button>
        ) : null}
        <output aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
          {t('list.count', { visible: visibleCount, total: totalCount })}
        </output>
      </div>
    </div>
  );
});

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();

  return (
    <details aria-label={label} data-filter-menu className="relative">
      <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-border bg-card px-2.5 text-sm text-muted-foreground shadow-xs hover:bg-hover">
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ''}
      </summary>
      <div className="thin-scrollbar absolute left-0 z-30 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-border bg-card p-1 shadow-popover">
        {options.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">{t('list.filter.noOptions')}</p>
        ) : null}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-hover"
          >
            <input
              type="checkbox"
              className="size-4"
              checked={selected.includes(option.value)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value)
                );
              }}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))].sort(collator.compare);
}

/** Keeps a deep-linked value visible even when the current data no longer has it. */
function withSelected(values: readonly string[], selected: readonly string[]): string[] {
  const result = [...values];
  for (const value of selected) {
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

import { memo, useEffect, useMemo, useRef, useState } from 'react';

import type { Issue } from '@/bindings/bd';
import { isEditableTarget, isOverlayOpen } from '@/app/keyboard/resolve';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { collator } from './collator';
import { hasActiveFilters } from './filter';
import { STATUS_ORDER, statusText } from '@/lib/status';
import {
  DEFAULT_SORT_DIRECTION,
  GROUP_VALUES,
  SORT_FIELDS,
  type GroupBy,
  type ListFilter,
  type ListViewState,
  type SortField,
} from './view-state';

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
}: FilterBarProps) {
  const { t } = useI18n();
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

  useEffect(() => {
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

  const statusOptions = useMemo(() => {
    const present = new Set(issues.map((issue) => issue.status));
    const extra = [...present].filter((status) => !STATUS_ORDER.includes(status)).sort();
    return withSelected([...STATUS_ORDER, ...extra], view.filter.status).map((value) => ({
      value,
      label: statusText(value, t),
    }));
  }, [issues, view.filter.status, t]);

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
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <Input
        ref={searchRef}
        type="search"
        aria-label={t('list.filter.search')}
        aria-keyshortcuts="/"
        placeholder={t('list.filter.search')}
        value={draftQuery}
        onChange={(event) => changeQuery(event.target.value)}
        className="w-64"
      />
      <MultiSelect
        label={t('list.filter.status')}
        options={statusOptions}
        selected={view.filter.status}
        onChange={(status) => updateFilter({ status })}
      />
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
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={view.filter.ready}
          onChange={(event) => updateFilter({ ready: event.target.checked })}
        />
        {t('list.filter.ready')}
      </label>
      <Select
        aria-label={t('list.filter.groupBy')}
        value={view.group}
        onChange={(event) => onChange({ ...view, group: event.target.value as GroupBy })}
      >
        {GROUP_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(GROUP_LABELS[value])}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('list.filter.sortBy')}
        value={view.sort.by}
        onChange={(event) => {
          const by = event.target.value as SortField;
          onChange({ ...view, sort: { by, direction: DEFAULT_SORT_DIRECTION[by] } });
        }}
      >
        {SORT_FIELDS.map((value) => (
          <option key={value} value={value}>
            {t(SORT_LABELS[value])}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="sm"
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
        className="text-muted-foreground"
      >
        {view.sort.direction === 'asc' ? '↑' : '↓'}
      </Button>
      {hasActiveFilters(view.filter) ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
          {t('list.filter.clear')}
        </Button>
      ) : null}
      <output aria-live="polite" className="ml-auto text-xs tabular-nums text-muted-foreground">
        {t('list.count', { visible: visibleCount, total: totalCount })}
      </output>
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
    <details aria-label={label} className="relative">
      <summary className="flex h-control-sm cursor-pointer list-none items-center rounded-md border border-border bg-card px-2 text-xs text-muted-foreground shadow-xs hover:bg-hover">
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ''}
      </summary>
      <div className="absolute left-0 z-30 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-border bg-card p-1 shadow-popover">
        {options.length === 0 ? (
          <p className="px-1 py-0.5 text-xs text-muted-foreground">{t('list.filter.noOptions')}</p>
        ) : null}
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-hover"
          >
            <input
              type="checkbox"
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

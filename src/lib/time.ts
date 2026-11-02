import type { Language } from '@/lib/i18n';

/**
 * Relative time for lists and comments. Constructing Intl objects is
 * comparatively expensive, so the formatters live for the life of the page.
 */
export function formatRelativeTime(value: string, language: Language): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  const formatter = relativeFormatter(language);

  if (magnitude < 60) {
    return formatter.format(seconds, 'second');
  }
  if (magnitude < 3600) {
    return formatter.format(Math.round(seconds / 60), 'minute');
  }
  if (magnitude < 86_400) {
    return formatter.format(Math.round(seconds / 3600), 'hour');
  }
  if (magnitude < 2_592_000) {
    return formatter.format(Math.round(seconds / 86_400), 'day');
  }
  if (magnitude < 31_536_000) {
    return formatter.format(Math.round(seconds / 2_592_000), 'month');
  }
  return formatter.format(Math.round(seconds / 31_536_000), 'year');
}

export function formatAbsoluteTime(value: string, language: Language): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : absoluteFormatter(language).format(timestamp);
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

function relativeFormatter(language: Language): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    relativeFormatters.set(language, formatter);
  }
  return formatter;
}

function absoluteFormatter(language: Language): Intl.DateTimeFormat {
  let formatter = absoluteFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language);
    absoluteFormatters.set(language, formatter);
  }
  return formatter;
}
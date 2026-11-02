/** Deterministic, locale-stable ordering for ids, titles and group keys. */
export const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

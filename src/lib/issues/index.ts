import type { Issue } from '@/bindings/bd';
import { emptyRecord } from '@/lib/records';

/** Resolves a dependency target; a missing id means "not in the store". */
export type IssueLookup = (id: string) => Issue | undefined;

/** Builds a prototype-safe issue lookup from the full issue list. */
export function indexById(issues: readonly Issue[]): Record<string, Issue> {
  const byId = emptyRecord<Issue>();
  for (const issue of issues) {
    byId[issue.id] = issue;
  }
  return byId;
}

/** A lookup that tolerates missing ids and never resolves through the prototype. */
export function lookupFrom(byId: Readonly<Record<string, Issue>> | undefined): IssueLookup {
  if (byId === undefined) {
    return () => undefined;
  }
  // Untrusted ids such as `__proto__` must not resolve through the prototype.
  return (id) => (Object.hasOwn(byId, id) ? byId[id] : undefined);
}

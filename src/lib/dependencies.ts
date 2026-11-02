/**
 * The dependency types that gate work. `parent-child`, `related` and
 * `discovered-from` are informational: treating them as blockers would make
 * every child of an epic unstartable, and every related ticket "blocked".
 */
export const BLOCKING_DEPENDENCY_TYPES = ['blocks', 'conditional-blocks', 'waits-for'] as const;

const BLOCKING = new Set<string>(BLOCKING_DEPENDENCY_TYPES);

export function isBlockingDependency(type: string): boolean {
  return BLOCKING.has(type);
}
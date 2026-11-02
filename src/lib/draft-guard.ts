/**
 * A single in-app draft guard. The detail screen registers one while an
 * editor is open; shell navigation checks it before unmounting the draft.
 * Returns true when leaving is allowed (no draft, or the user confirmed).
 */
type DraftGuard = () => boolean;

let guard: DraftGuard | null = null;

export function setDraftGuard(next: DraftGuard | null): void {
  guard = next;
}

export function confirmLeaveDraft(): boolean {
  return guard === null || guard();
}

/** True while an editor holds an unsaved draft. */
export function isDraftOpen(): boolean {
  return guard !== null;
}
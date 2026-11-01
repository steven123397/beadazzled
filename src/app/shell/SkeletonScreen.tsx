/** Busy placeholder for work that is loading; never an empty list or a blank pane. */
export function SkeletonScreen({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3 p-6">
      <div className="h-5 w-40 animate-pulse rounded bg-neutral-800" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-9 animate-pulse rounded bg-neutral-900"
            style={{ animationDelay: `${index * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

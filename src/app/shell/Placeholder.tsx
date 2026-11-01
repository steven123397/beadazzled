import { useParams } from 'react-router-dom';

/** Route target for a module that lands in a later phase. */
export function Placeholder({ title }: { title: string }) {
  return (
    <section className="space-y-1 p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-neutral-500">This view arrives in a later phase.</p>
    </section>
  );
}

export function IssuePlaceholder() {
  const { issueId } = useParams<{ issueId: string }>();

  return (
    <section className="space-y-1 p-6">
      <h1 className="text-lg font-semibold">Issue {issueId}</h1>
      <p className="text-sm text-neutral-500">This view arrives in a later phase.</p>
    </section>
  );
}

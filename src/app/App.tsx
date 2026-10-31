// Placeholder shell. The real layout, routing and theme tokens land with the
// `shell` module (bza-4mq); this only proves the scaffold renders end to end.
export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-neutral-950 font-sans text-neutral-100">
      <h1 className="text-2xl font-semibold tracking-tight">beadazzled</h1>
      <p className="text-sm text-neutral-400">v0.1.0 scaffold</p>
    </main>
  );
}
/**
 * A link dragged onto the window makes the webview follow it, which would take
 * the app to a foreign origin outside React Router's reach (and outside the
 * draft guard). Nothing in the app accepts drops, so they are cancelled at the
 * window. Returns a cleanup for tests and for a future drop-enabled surface.
 */
export function blockWindowDrops(target: Window = window): () => void {
  const cancel = (event: Event) => {
    event.preventDefault();
  };
  target.addEventListener('dragover', cancel);
  target.addEventListener('drop', cancel);
  return () => {
    target.removeEventListener('dragover', cancel);
    target.removeEventListener('drop', cancel);
  };
}

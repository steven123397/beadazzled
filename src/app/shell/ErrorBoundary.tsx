import { Component, type ErrorInfo, type ReactNode } from 'react';

type State = { error: Error | null };

/** Keeps a render failure from turning the window white. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error', error, info.componentStack);
  }

  private copyDiagnostics = (): void => {
    const error = this.state.error;
    if (error === null) {
      return;
    }
    void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n${error.stack ?? ''}`);
  };

  render() {
    const error = this.state.error;
    if (error === null) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-neutral-100"
      >
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="font-mono text-sm text-red-400">
          {error.name}: {error.message}
        </p>
        <button
          type="button"
          onClick={this.copyDiagnostics}
          className="rounded border border-neutral-700 px-3 py-1 text-sm"
        >
          Copy diagnostics
        </button>
      </div>
    );
  }
}

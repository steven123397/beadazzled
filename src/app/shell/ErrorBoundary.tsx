import { Component, type ErrorInfo, type ReactNode } from 'react';

import { copyText, type CopyResult } from '@/lib/clipboard';

type Props = {
  title: string;
  copyLabel: string;
  /** Shown after a copy attempt; omitted means no feedback line. */
  copiedLabel?: string;
  failedLabel?: string;
  children: ReactNode;
};
type State = { error: Error | null; copy: CopyResult | null };

/** Keeps a render failure from turning the window white. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copy: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
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
    void copyText(`${error.name}: ${error.message}\n${error.stack ?? ''}`).then((copy) =>
      this.setState({ copy })
    );
  };

  render() {
    const error = this.state.error;
    if (error === null) {
      return this.props.children;
    }

    const notice =
      this.state.copy === 'copied'
        ? this.props.copiedLabel
        : this.state.copy === 'failed'
          ? this.props.failedLabel
          : undefined;

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-8 text-foreground"
      >
        <h1 className="text-lg font-semibold">{this.props.title}</h1>
        <p className="font-mono text-sm text-destructive">
          {error.name}: {error.message}
        </p>
        <button
          type="button"
          onClick={this.copyDiagnostics}
          className="rounded border border-border px-3 py-1 text-sm"
        >
          {this.props.copyLabel}
        </button>
        {notice === undefined ? null : (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
    );
  }
}

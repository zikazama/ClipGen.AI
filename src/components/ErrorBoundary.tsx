import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors so a broken component shows a readable message
 * instead of a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error while rendering ClipGen.AI', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="modal-overlay">
        <div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="clipgen-error-title">
          <h2 id="clipgen-error-title" className="modal-title">
            Something went wrong
          </h2>
          <p className="modal-subtitle">{error.message}</p>
          <button type="button" className="btn-primary" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}

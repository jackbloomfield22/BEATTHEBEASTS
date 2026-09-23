import { Component, type ErrorInfo, type ReactNode } from 'react';

// Crash recovery. The 3D stage sits in its own boundary: an error inside the
// Canvas (R3F rethrows scene errors into the React tree) remounts the
// renderer instead of taking the menus down with it. The app boundary is the
// last resort: a readable error screen with a reload, never a black page.

export class StageBoundary extends Component<{ children: ReactNode; onCrash: (error: Error) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[stage] renderer crashed; remounting', error, info.componentStack);
    this.props.onCrash(error);
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export class AppBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] crashed', error, info.componentStack);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') location.reload();
    });
  }
  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="gate" role="alert">
        <div className="gate-inner">
          <p className="gate-text">Something went wrong and the game stopped.</p>
          <p className="gate-sub">Press Enter or click Reload to start again. If it keeps happening, the message below helps us fix it.</p>
          <pre className="gate-error">{String(error.message || error)}</pre>
          <button className="gate-link" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

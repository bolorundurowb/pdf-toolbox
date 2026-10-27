import { signal } from '@angular/core';
import { OperationResult, ProgressPayload } from './models';

export type Stage = 'idle' | 'processing' | 'done' | 'error';

/** Small reusable state machine for "configure → process → done" flows. */
export function createRunner(onCancel?: () => void) {
  const stage = signal<Stage>('idle');
  const progress = signal(0);
  const message = signal('');
  const result = signal<OperationResult | null>(null);
  const error = signal<string | null>(null);
  /** True once Cancel has been pressed for the current run. */
  const cancelled = signal(false);

  const onProgress = (p: ProgressPayload) => {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : progress();
    progress.set(pct);
    if (p.message) message.set(p.message);
  };

  async function run(task: (op: (p: ProgressPayload) => void) => Promise<OperationResult>) {
    error.set(null);
    progress.set(0);
    cancelled.set(false);
    message.set('Working locally — nothing is uploaded.');
    stage.set('processing');
    try {
      const res = await task(onProgress);
      progress.set(100);
      result.set(res);
      stage.set('done');
    } catch (e) {
      if (cancelled()) {
        // A cooperative stop still counts as a finished job: show what was
        // saved rather than an error the user did not cause.
        result.set({ files: [], outDir: '', stopped: true });
        progress.set(100);
        stage.set('done');
        return;
      }
      error.set(describe(e));
      stage.set('error');
    }
  }

  /** Asks the backend to stop between units of work. The flag is checked per page too. */
  function cancel() {
    if (stage() !== 'processing' || cancelled()) return;
    cancelled.set(true);
    message.set('Stopping…');
    onCancel?.();
  }

  /** Shows the error panel without running anything — e.g. an unreadable file. */
  function fail(reason: string) {
    error.set(reason);
    result.set(null);
    stage.set('error');
  }

  /**
   * Runs a non-processing step (picking or inspecting files) and shows the error
   * panel if it throws, instead of failing silently with an unhandled rejection.
   */
  async function attempt(task: () => Promise<void>) {
    try {
      await task();
    } catch (e) {
      fail(describe(e));
    }
  }

  /** Leaves the error panel but keeps everything the user had entered. */
  function back() {
    stage.set('idle');
    progress.set(0);
    message.set('');
    error.set(null);
    cancelled.set(false);
  }

  function reset() {
    stage.set('idle');
    progress.set(0);
    message.set('');
    result.set(null);
    error.set(null);
    cancelled.set(false);
  }

  return { stage, progress, message, result, error, cancelled, run, cancel, fail, attempt, back, reset };
}

export function describe(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

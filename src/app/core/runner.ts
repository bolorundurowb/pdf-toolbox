import { signal } from '@angular/core';
import { OperationResult, ProgressPayload } from './models';

export type Stage = 'idle' | 'processing' | 'done' | 'error';

/** Small reusable state machine for "configure → process → done" flows. */
export function createRunner() {
  const stage = signal<Stage>('idle');
  const progress = signal(0);
  const message = signal('');
  const result = signal<OperationResult | null>(null);
  const error = signal<string | null>(null);

  const onProgress = (p: ProgressPayload) => {
    const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : progress();
    progress.set(pct);
    if (p.message) message.set(p.message);
  };

  async function run(task: (op: (p: ProgressPayload) => void) => Promise<OperationResult>) {
    error.set(null);
    progress.set(0);
    message.set('Working locally — nothing is uploaded.');
    stage.set('processing');
    try {
      const res = await task(onProgress);
      progress.set(100);
      result.set(res);
      stage.set('done');
    } catch (e) {
      error.set(describe(e));
      stage.set('error');
    }
  }

  function reset() {
    stage.set('idle');
    progress.set(0);
    message.set('');
    result.set(null);
    error.set(null);
  }

  return { stage, progress, message, result, error, run, reset };
}

function describe(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}

import { Injectable, signal } from '@angular/core';

/**
 * Files handed to the dashboard by a second app launch (a PDF double-click).
 * A signal is used rather than router state alone so the dashboard updates even
 * when it is already the active route.
 */
@Injectable({ providedIn: 'root' })
export class OpenFilesService {
  readonly pending = signal<string[]>([]);

  show(paths: string[]): void {
    if (paths.length > 0) this.pending.set(paths);
  }

  take(): string[] {
    const paths = this.pending();
    this.pending.set([]);
    return paths;
  }
}

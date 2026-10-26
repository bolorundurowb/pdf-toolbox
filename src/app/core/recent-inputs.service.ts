import { Injectable, signal } from '@angular/core';
import { InputFile, RecentInput } from './models';

const STORAGE_KEY = 'pdf-toolbox.recent-inputs';
const LIMIT = 12;

/** Remembered inputs, so the dashboard can offer "open in a tool" afterwards. */
@Injectable({ providedIn: 'root' })
export class RecentInputsService {
  readonly items = signal<RecentInput[]>(load());

  remember(files: readonly InputFile[]): void {
    if (files.length === 0) return;
    const now = Date.now();
    const fresh = files
      .filter((f) => !f.error)
      .map((f) => ({ path: f.path, name: f.name, size: f.size, opened: now }));
    if (fresh.length === 0) return;

    const paths = new Set(fresh.map((f) => f.path));
    const next = [...fresh, ...this.items().filter((f) => !paths.has(f.path))].slice(0, LIMIT);
    this.set(next);
  }

  remove(path: string): void {
    this.set(this.items().filter((f) => f.path !== path));
  }

  clear(): void {
    this.set([]);
  }

  private set(items: RecentInput[]): void {
    this.items.set(items);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Remembering inputs is a convenience; failing to persist is harmless.
    }
  }
}

function load(): RecentInput[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function isRecent(value: unknown): value is RecentInput {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentInput>;
  return typeof item.path === 'string'
    && typeof item.name === 'string'
    && typeof item.size === 'number'
    && typeof item.opened === 'number';
}

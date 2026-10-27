import { Injectable, computed, signal } from '@angular/core';
import { ask, open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { AppSettings, ConflictPolicy, ThemeChoice } from './models';
import { PdfService } from './pdf.service';

const STORAGE_KEY = 'pdf-toolbox.settings';

const DEFAULTS: AppSettings = {
  outputFolder: '',
  askEveryTime: false,
  onConflict: 'keep',
  theme: 'system',
  autoUpdate: true,
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      outputFolder: typeof parsed.outputFolder === 'string' ? parsed.outputFolder : '',
      askEveryTime: parsed.askEveryTime === true,
      onConflict: isConflict(parsed.onConflict) ? parsed.onConflict : DEFAULTS.onConflict,
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULTS.theme,
      autoUpdate: parsed.autoUpdate !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function isConflict(value: unknown): value is ConflictPolicy {
  return value === 'keep' || value === 'overwrite' || value === 'ask';
}

function isTheme(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * User preferences, persisted in localStorage. The save location, name-clash
 * behaviour and update checks all pass through here so every tool agrees.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<AppSettings>(load());
  /** Set when a saved output folder has disappeared and the default is in use. */
  readonly missingSavedFolder = signal(false);

  readonly outputFolderLabel = computed(() => this.settings().outputFolder);

  constructor(private readonly pdf: PdfService) {
    this.applyTheme(this.settings().theme);
  }

  update(partial: Partial<AppSettings>): void {
    const next = { ...this.settings(), ...partial };
    this.settings.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or a locked profile: the session still works.
    }
    if (partial.theme) this.applyTheme(partial.theme);
    if (partial.outputFolder !== undefined) this.missingSavedFolder.set(false);
  }

  /** The folder output goes to when the user is not asked each time. */
  async outputDir(): Promise<string> {
    const saved = this.settings().outputFolder.trim();
    if (!saved) return this.pdf.defaultOutputDir();
    try {
      if (await exists(saved)) return saved;
    } catch {
      // Fall through to the default folder.
    }
    this.update({ outputFolder: '' });
    this.missingSavedFolder.set(true);
    return this.pdf.defaultOutputDir();
  }

  /**
   * Resolves the folder for one run. Returns null when the directory dialog is
   * dismissed, so the caller can leave the job unstarted.
   */
  async resolveOutputDir(): Promise<string | null> {
    const current = await this.outputDir();
    if (!this.settings().askEveryTime) return current;
    const picked = await open({ directory: true, multiple: false, defaultPath: current });
    return typeof picked === 'string' ? picked : null;
  }

  /** Opens the directory picker for the Settings page. */
  async chooseOutputFolder(): Promise<void> {
    const current = await this.outputDir();
    const picked = await open({ directory: true, multiple: false, defaultPath: current });
    if (typeof picked === 'string') this.update({ outputFolder: picked });
  }

  resetOutputFolder(): void {
    this.update({ outputFolder: '' });
    this.missingSavedFolder.set(false);
  }

  /**
   * Turns the saved clash policy into a concrete choice. "Ask" is resolved here,
   * before a job starts, by checking the expected names and prompting once.
   */
  async resolveConflict(dir: string, names: readonly string[]): Promise<'keep' | 'overwrite'> {
    const policy = this.settings().onConflict;
    if (policy !== 'ask') return policy;

    let clash = false;
    for (const name of names) {
      try {
        if (await exists(await join(dir, name))) {
          clash = true;
          break;
        }
      } catch {
        // If the check itself fails, keep both rather than risk overwriting.
      }
    }
    if (!clash) return 'keep';

    const overwrite = await ask(
      'One or more output files already exist. Overwrite them, or keep both copies?',
      {
        title: 'Output files already exist',
        kind: 'warning',
        okLabel: 'Overwrite',
        cancelLabel: 'Keep both',
      },
    );
    return overwrite ? 'overwrite' : 'keep';
  }

  private applyTheme(theme: ThemeChoice): void {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }
}

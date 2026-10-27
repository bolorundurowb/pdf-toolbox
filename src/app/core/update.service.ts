import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { UpdateInfo } from './models';
import { PdfService } from './pdf.service';
import { SettingsService } from './settings.service';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * One source of truth for update checks, shared by the sidebar banner and the
 * Settings page. Automatic checks are skipped when the user turns them off;
 * "Check now" always runs.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly info = signal<UpdateInfo | null>(null);
  readonly checking = signal(false);
  readonly version = signal('');

  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
    void this.loadVersion();
  }

  async loadVersion(): Promise<void> {
    try {
      this.version.set(await this.pdf.appVersion());
    } catch {
      this.version.set('');
    }
  }

  /** Starts or stops the six-hour timer to match the saved preference. */
  syncSchedule(): void {
    this.stopTimer();
    if (!this.settings.settings().autoUpdate) return;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
  }

  async checkNow(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    try {
      this.info.set(await this.pdf.checkUpdate());
    } catch {
      this.info.set(null);
    } finally {
      this.checking.set(false);
    }
  }

  openReleases(): void {
    const url = this.info()?.releaseUrl;
    if (url) void this.pdf.openUrl(url).catch(() => undefined);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

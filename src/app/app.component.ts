import { Component, OnDestroy, OnInit, effect } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { NAV_GROUPS, SETTINGS_ITEM } from './core/nav.config';
import { PdfService } from './core/pdf.service';
import { OpenFilesService } from './core/open-files.service';
import { SettingsService } from './core/settings.service';
import { UpdateService } from './core/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly navGroups = NAV_GROUPS;
  readonly settingsItem = SETTINGS_ITEM;

  private unlisten?: UnlistenFn;

  constructor(
    public readonly settings: SettingsService,
    public readonly updates: UpdateService,
    private readonly pdf: PdfService,
    private readonly openFiles: OpenFilesService,
    private readonly router: Router,
  ) {
    // Start or stop the six-hour update timer as the preference changes.
    effect(() => {
      this.settings.settings().autoUpdate;
      this.updates.syncSchedule();
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      this.unlisten = await this.pdf.listenForOpenFiles((paths) => {
        // A second launch (double-clicking a PDF) belongs on the dashboard,
        // where the user picks a tool. The signal also covers the case where
        // the dashboard is already showing.
        this.openFiles.show(paths);
        void this.router.navigate(['/dashboard']);
      });
    } catch {
      // Outside the Tauri shell there is no single-instance event.
    }
  }

  ngOnDestroy(): void {
    this.unlisten?.();
  }

  openReleases(): void {
    this.updates.openReleases();
  }

  /** Release tags already carry a leading `v` (`v1.2.0`); strip it so the UI doesn't show `vv1.2.0`. */
  bare(version: string | undefined): string {
    return (version ?? '').replace(/^v/i, '');
  }
}

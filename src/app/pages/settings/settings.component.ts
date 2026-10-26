import { Component, OnInit, signal } from '@angular/core';
import { ConflictPolicy, ThemeChoice } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { UpdateService } from '../../core/update.service';
import { ToolPageComponent } from '../../shared/tool-page.component';

@Component({
  selector: 'app-settings',
  imports: [ToolPageComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  readonly resolvedFolder = signal('');

  readonly conflicts: { id: ConflictPolicy; label: string; hint: string }[] = [
    { id: 'keep', label: 'Keep both', hint: 'Add (2) before the extension, as before' },
    { id: 'overwrite', label: 'Overwrite', hint: 'Replace the existing file' },
    { id: 'ask', label: 'Ask each time', hint: 'Prompt before the job starts' },
  ];

  readonly themes: { id: ThemeChoice; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: 'light_mode' },
    { id: 'dark', label: 'Dark', icon: 'dark_mode' },
    { id: 'system', label: 'System', icon: 'contrast' },
  ];

  constructor(
    public readonly settings: SettingsService,
    public readonly updates: UpdateService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.refreshFolder();
    await this.updates.loadVersion();
  }

  private async refreshFolder(): Promise<void> {
    this.resolvedFolder.set(await this.settings.outputDir());
  }

  async chooseFolder(): Promise<void> {
    await this.settings.chooseOutputFolder();
    await this.refreshFolder();
  }

  async resetFolder(): Promise<void> {
    this.settings.resetOutputFolder();
    await this.refreshFolder();
  }

  setConflict(policy: ConflictPolicy): void {
    this.settings.update({ onConflict: policy });
  }

  setTheme(theme: ThemeChoice): void {
    this.settings.update({ theme });
  }

  toggleAskEveryTime(on: boolean): void {
    this.settings.update({ askEveryTime: on });
  }

  toggleAutoUpdate(on: boolean): void {
    this.settings.update({ autoUpdate: on });
    this.updates.syncSchedule();
  }

  async checkNow(): Promise<void> {
    await this.updates.checkNow();
  }

  bare(version: string | undefined): string {
    return (version ?? '').replace(/^v/i, '');
  }
}

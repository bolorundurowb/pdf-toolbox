import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NAV_ITEMS } from './core/nav.config';
import { PdfService } from './core/pdf.service';
import { UpdateInfo } from './core/models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly nav = NAV_ITEMS;
  readonly version = signal('');
  readonly updateInfo = signal<UpdateInfo | null>(null);
  readonly checkingUpdate = signal(false);

  private updateTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly pdf: PdfService) {}

  async ngOnInit(): Promise<void> {
    try {
      this.version.set(await this.pdf.appVersion());
    } catch {
      this.version.set('');
    }
    void this.checkNow();
    // Re-check every 6 hours.
    this.updateTimer = setInterval(() => void this.checkNow(), 6 * 60 * 60 * 1000);
  }

  async checkNow(): Promise<void> {
    this.checkingUpdate.set(true);
    try {
      this.updateInfo.set(await this.pdf.checkUpdate());
    } catch {
      this.updateInfo.set(null);
    } finally {
      this.checkingUpdate.set(false);
    }
  }

  openReleases(): void {
    const url = this.updateInfo()?.releaseUrl;
    if (url) void this.pdf.openPath(url);
  }

  ngOnDestroy(): void {
    if (this.updateTimer) clearInterval(this.updateTimer);
  }
}

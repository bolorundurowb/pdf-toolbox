import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PdfService } from '../../core/pdf.service';
import { RecentFile } from '../../core/models';
import { formatBytes, formatDate } from '../../core/format';

interface QuickAction {
  label: string;
  hint: string;
  icon: string;
  route: string;
  iconBg: string;
  iconFg: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  readonly fmtBytes = formatBytes;
  readonly fmtDate = formatDate;

  readonly recent = signal<RecentFile[]>([]);
  readonly loading = signal(true);

  readonly actions: QuickAction[] = [
    { label: 'Image to PDF', hint: 'JPG, PNG, TIFF', icon: 'image', route: '/images', iconBg: 'bg-secondary-container', iconFg: 'text-primary' },
    { label: 'Merge/Split', hint: 'Combine or divide', icon: 'call_merge', route: '/merge-split', iconBg: 'bg-tertiary-fixed', iconFg: 'text-tertiary' },
    { label: 'Compress', hint: 'Optimise size', icon: 'compress', route: '/compress', iconBg: 'bg-primary-fixed', iconFg: 'text-primary' },
    { label: 'Security', hint: 'Protect / Unlock', icon: 'security', route: '/security', iconBg: 'bg-error-container', iconFg: 'text-error' },
    { label: 'Metadata', hint: 'Edit properties', icon: 'info', route: '/metadata', iconBg: 'bg-outline-variant/30', iconFg: 'text-on-surface-variant' },
  ];

  constructor(private readonly pdf: PdfService) {}

  async ngOnInit(): Promise<void> {
    try {
      this.recent.set(await this.pdf.recentOutputs());
    } catch {
      this.recent.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  open(f: RecentFile): void {
    void this.pdf.openPath(f.path);
  }

  reveal(f: RecentFile): void {
    void this.pdf.openFolderOf(f.path);
  }
}

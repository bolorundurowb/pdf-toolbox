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
    { label: 'Image to PDF', hint: 'JPG, PNG, TIFF', icon: 'image', route: '/images' },
    { label: 'Merge/Split', hint: 'Combine or divide', icon: 'call_merge', route: '/merge-split' },
    { label: 'Compress', hint: 'Optimise size', icon: 'compress', route: '/compress' },
    { label: 'Security', hint: 'Protect / Unlock', icon: 'security', route: '/security' },
    { label: 'Metadata', hint: 'Edit properties', icon: 'info', route: '/metadata' },
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

import { Component, OnInit, effect, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfService } from '../../core/pdf.service';
import { InputFile, RecentFile } from '../../core/models';
import { formatBytes, formatDate } from '../../core/format';
import { OpenFilesService } from '../../core/open-files.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { SettingsService } from '../../core/settings.service';
import { useFileDrop } from '../../core/file-drop';
import { routerPaths } from '../../core/tool-nav';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';

interface ToolLink {
  label: string;
  icon: string;
  route: string;
}

interface ToolChoice {
  label: string;
  icon: string;
  route: string;
  hint: string;
}

const DROP_ACCEPT = /\.(pdf|jpe?g|png|gif|bmp|tiff?|webp|heic|heif)$/i;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, FileDropZoneComponent, DropOverlayComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  readonly fmtBytes = formatBytes;
  readonly fmtDate = formatDate;

  readonly recent = signal<RecentFile[]>([]);
  readonly loading = signal(true);
  readonly outputFolder = signal('');
  /** Files waiting for the user to pick a tool. */
  readonly pending = signal<string[]>([]);

  readonly tools: ToolLink[] = [
    { label: 'Image to PDF', icon: 'image', route: '/images' },
    { label: 'Merge', icon: 'call_merge', route: '/merge' },
    { label: 'Organise', icon: 'reorder', route: '/organize' },
    { label: 'Extract', icon: 'article', route: '/extract' },
    { label: 'Convert', icon: 'transform', route: '/convert' },
    { label: 'Compress', icon: 'compress', route: '/compress' },
    { label: 'Security', icon: 'security', route: '/security' },
    { label: 'Metadata', icon: 'info', route: '/metadata' },
  ];

  readonly pdfTools: ToolChoice[] = [
    { label: 'Merge', icon: 'call_merge', route: '/merge', hint: 'Combine with other PDFs' },
    { label: 'Organise', icon: 'reorder', route: '/organize', hint: 'Reorder or rotate pages' },
    { label: 'Extract', icon: 'article', route: '/extract', hint: 'Pages, text or images' },
    { label: 'Convert', icon: 'transform', route: '/convert', hint: 'Save as Word' },
    { label: 'Compress', icon: 'compress', route: '/compress', hint: 'Make it smaller' },
    { label: 'Security', icon: 'security', route: '/security', hint: 'Add or remove a password' },
    { label: 'Metadata', icon: 'info', route: '/metadata', hint: 'Edit properties' },
  ];

  readonly imageChoice: ToolChoice = {
    label: 'Image to PDF', icon: 'image', route: '/images', hint: 'Turn these images into a PDF',
  };

  private readonly launchShownKey = 'pdf-toolbox.launch-files-shown';

  readonly dropActive = useFileDrop({
    accept: DROP_ACCEPT,
    onDrop: (paths) => this.pending.set(paths),
  });

  constructor(
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
    public readonly recents: RecentInputsService,
    public readonly openFiles: OpenFilesService,
    private readonly router: Router,
  ) {
    effect(() => {
      const paths = this.openFiles.pending();
      if (paths.length > 0) this.pending.set(this.openFiles.take());
    });
  }

  async ngOnInit(): Promise<void> {
    await this.load();
    // A file opened from the results panel or the app's open-file event.
    const routed = routerPaths();
    if (routed.length > 0) this.pending.set(routed);
    try {
      const launched = await this.pdf.launchFiles();
      if (launched.length > 0 && !sessionStorage.getItem(this.launchShownKey)) {
        sessionStorage.setItem(this.launchShownKey, '1');
        this.pending.set(launched);
      }
    } catch {
      // No command-line hand-off in a plain browser.
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const dir = await this.settings.outputDir();
      this.outputFolder.set(dir);
      this.recent.set(await this.pdf.recentOutputs(dir));
    } catch {
      this.recent.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  open(f: RecentFile | { path: string }): void {
    void this.pdf.openPath(f.path);
  }

  reveal(f: RecentFile | { path: string }): void {
    void this.pdf.openFolderOf(f.path);
  }

  /** Opens the dashboard's tool chooser for a recent file. */
  askFor(path: string): void {
    this.pending.set([path]);
  }

  async askForChoose(): Promise<void> {
    try {
      const paths = await this.pdf.pickAny(true);
      if (paths.length > 0) this.pending.set(paths);
    } catch {
      // A dismissed dialog simply leaves the dashboard as it was.
    }
  }

  chooseFor(event: Event, path: string): void {
    const select = event.target as HTMLSelectElement;
    const route = select.value;
    select.value = '';
    if (!route) return;
    this.pending.set([path]);
    this.choose(route);
  }

  dismissChoice(): void {
    this.pending.set([]);
  }

  choose(route: string): void {
    const paths = this.pathsFor(route);
    this.pending.set([]);
    if (paths.length === 0) return;
    void this.router.navigate([route], { state: { paths } });
  }

  /** Keeps images away from PDF tools and PDFs away from Image to PDF. */
  pathsFor(route: string): string[] {
    const paths = this.pending();
    return route === '/images' ? paths.filter(isImagePath) : paths.filter((p) => !isImagePath(p));
  }

  hasImages(): boolean {
    return this.pending().some(isImagePath);
  }

  hasPdfs(): boolean {
    return this.pending().some((p) => !isImagePath(p));
  }

  pendingNames(): string {
    const paths = this.pending();
    const first = paths[0]?.slice(Math.max(paths[0].lastIndexOf('/'), paths[0].lastIndexOf('\\')) + 1) ?? '';
    return paths.length > 1 ? `${first} and ${paths.length - 1} more` : first;
  }

  isImage(f: InputFile | { name: string }): boolean {
    return isImagePath(f.name);
  }

  async refreshRecent(): Promise<void> {
    await this.load();
  }
}

function isImagePath(path: string): boolean {
  return DROP_ACCEPT.test(path) && !/\.pdf$/i.test(path);
}

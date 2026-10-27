import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { PdfService } from '../../core/pdf.service';
import { createRunner } from '../../core/runner';
import { CompressEstimate, CompressLevel, InputFile } from '../../core/models';
import { formatBytes, pluralize } from '../../core/format';
import { SettingsService } from '../../core/settings.service';
import { RecentInputsService } from '../../core/recent-inputs.service';
import { ProcessStatusComponent } from '../../shared/process-status.component';
import { DropOverlayComponent } from '../../shared/drop-overlay.component';
import { ToolPageComponent } from '../../shared/tool-page.component';
import { FileDropZoneComponent } from '../../shared/file-drop-zone.component';
import { PDF_FILE, useFileDrop } from '../../core/file-drop';
import { mergeUnique } from '../../core/files';
import { useShortcuts } from '../../core/shortcuts';
import { stemOf } from '../../core/output-names';
import { routerPaths } from '../../core/tool-nav';

interface LevelInfo {
  id: CompressLevel;
  name: string;
  hint: string;
  detail: string;
}

/** Five steps, so moving the slider one notch is a moderate change, not a leap. */
const LEVELS: LevelInfo[] = [
  { id: 'minimal', name: 'Minimal', hint: 'Best quality', detail: 'Re-encodes images at full resolution — barely visible changes.' },
  { id: 'light', name: 'Light', hint: 'High quality', detail: 'Caps images at ~2400 px — good for printing.' },
  { id: 'balanced', name: 'Balanced', hint: 'Recommended', detail: 'Caps images at ~1600 px — great for sharing and email.' },
  { id: 'strong', name: 'Strong', hint: 'Smaller', detail: 'Caps images at ~1200 px — fine for reading on screen.' },
  { id: 'extreme', name: 'Extreme', hint: 'Smallest file', detail: 'Caps images at ~1000 px with heavy compression — some blurring.' },
];

/** Wait for the slider to settle before re-estimating. */
const ESTIMATE_DEBOUNCE_MS = 350;

@Component({
  selector: 'app-compress',
  imports: [ProcessStatusComponent, DropOverlayComponent, ToolPageComponent, FileDropZoneComponent],
  templateUrl: './compress.component.html',
})
export class CompressComponent implements OnInit {
  readonly fmtBytes = formatBytes;
  readonly runner = createRunner(() => void this.pdf.cancelJob());

  readonly files = signal<InputFile[]>([]);
  readonly grayscale = signal(false);
  readonly removeMetadata = signal(false);

  readonly levels = LEVELS;
  /** Slider position, 1-based. */
  readonly levelIndex = signal(3);
  readonly levelInfo = computed(() => LEVELS[Math.min(LEVELS.length, Math.max(1, this.levelIndex())) - 1]);
  readonly level = computed<CompressLevel>(() => this.levelInfo().id);

  readonly okFiles = computed(() => this.files().filter((f) => !f.error));
  readonly total = computed(() => this.okFiles().reduce((a, f) => a + f.size, 0));
  readonly canRun = computed(() => this.okFiles().length > 0);

  /* ------------------------------ estimate ------------------------------- */

  /** Latest estimate per path, for the current level and greyscale choice. */
  readonly estimates = signal<Map<string, CompressEstimate>>(new Map());
  readonly estimating = signal(false);
  private estimateTimer?: ReturnType<typeof setTimeout>;
  private estimateRun = 0;

  /** Summed estimate across the listed files, or null until one is available. */
  readonly estimatedTotal = computed(() => {
    const files = this.okFiles();
    if (files.length === 0) return null;
    const map = this.estimates();
    let sum = 0;
    for (const f of files) {
      const e = map.get(f.path);
      if (!e) return null;
      sum += e.estimated;
    }
    return sum;
  });

  readonly estimatedSaving = computed(() => {
    const est = this.estimatedTotal();
    const total = this.total();
    if (est === null || total === 0) return null;
    return Math.max(0, Math.round((1 - est / total) * 100));
  });

  readonly dropActive = useFileDrop({
    accept: PDF_FILE,
    onDrop: (paths) => void this.ingestFrom(paths),
    enabled: () => this.runner.stage() === 'idle',
  });

  constructor(
    public readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly recents: RecentInputsService,
  ) {
    // Re-estimate whenever the files, level or greyscale choice change.
    effect(() => {
      const paths = this.okFiles().map((f) => f.path);
      const options = { level: this.level(), grayscale: this.grayscale(), removeMetadata: false };
      this.scheduleEstimate(paths, options);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.estimateTimer));
    useShortcuts({
      onOpen: () => void this.addFiles(),
      onRun: () => void this.apply(),
      enabled: () => this.runner.stage() === 'idle',
      canRun: () => this.canRun(),
    });
  }

  async ngOnInit(): Promise<void> {
    const paths = routerPaths().filter((path) => PDF_FILE.test(path));
    if (paths.length > 0) await this.ingestFrom(paths);
  }

  private scheduleEstimate(paths: string[], options: { level: CompressLevel; grayscale: boolean; removeMetadata: boolean }): void {
    clearTimeout(this.estimateTimer);
    const run = ++this.estimateRun;
    // Old numbers would be misleading for the new settings.
    this.estimates.set(new Map());
    if (paths.length === 0) {
      this.estimating.set(false);
      return;
    }
    this.estimating.set(true);
    this.estimateTimer = setTimeout(async () => {
      try {
        const results = await this.pdf.estimateCompression(paths, options);
        if (run !== this.estimateRun) return; // superseded by a newer request
        this.estimates.set(new Map(results.map((r) => [r.path, r])));
      } catch {
        // An estimate is a nicety; the compress button still works without it.
      } finally {
        if (run === this.estimateRun) this.estimating.set(false);
      }
    }, ESTIMATE_DEBOUNCE_MS);
  }

  estimateFor(f: InputFile): CompressEstimate | undefined {
    return this.estimates().get(f.path);
  }

  savingFor(f: InputFile): number | null {
    const e = this.estimateFor(f);
    if (!e || e.original === 0) return null;
    return Math.max(0, Math.round((1 - e.estimated / e.original) * 100));
  }

  /* ------------------------------- files --------------------------------- */

  async addFiles(): Promise<void> {
    await this.runner.attempt(async () => this.ingest(await this.pdf.pickPdfs(true)));
  }

  private async ingestFrom(paths: string[]): Promise<void> {
    await this.runner.attempt(() => this.ingest(paths));
  }

  private async ingest(paths: string[]): Promise<void> {
    if (!paths.length) return;
    const inspected = await this.pdf.inspect(paths);
    // Compressing the same file twice in one run is never useful, and duplicate
    // paths would also collide in the `@for` track key.
    const added = mergeUnique(this.files(), inspected.filter((f) => f.kind === 'pdf'));
    this.files.set(added);
    this.recents.remember(inspected);
  }

  remove(i: number) { this.files.update((c) => c.filter((_, x) => x !== i)); }

  clearAll() {
    if (this.files().length > 0 && !window.confirm('Remove all files from this list?')) return;
    this.files.set([]);
  }

  summary(): string {
    return `${pluralize(this.okFiles().length, 'file')} · ${formatBytes(this.total())} · ${this.levelInfo().name}`;
  }

  async apply(): Promise<void> {
    if (!this.canRun()) return;
    const outDir = await this.settings.resolveOutputDir();
    if (!outDir) return;
    const names = this.okFiles().map((f) => `${stemOf(f.name)} (compressed).pdf`);
    const conflict = await this.settings.resolveConflict(outDir, names);
    const paths = this.okFiles().map((f) => f.path);
    await this.runner.run((op) =>
      this.pdf.compressPdfs(
        paths,
        {
          level: this.level(),
          grayscale: this.grayscale(),
          removeMetadata: this.removeMetadata(),
          onConflict: conflict,
        },
        outDir, op,
      ),
    );
  }

  reset() { this.runner.reset(); this.files.set([]); }
  openResultFolder() { const r = this.runner.result(); if (r?.outDir) void this.pdf.openFolder(r.outDir); }
}

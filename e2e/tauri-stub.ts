import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const FIXTURES = join(__dirname, 'fixtures');

function base64(name: string): string {
  return readFileSync(join(FIXTURES, name)).toString('base64');
}

export interface StubOptions {
  theme?: 'light' | 'dark' | 'system';
}

/**
 * Installs a fake Tauri bridge before the app boots. The Angular code only ever
 * talks to Tauri through `invoke` and `convertFileSrc`, so this exercises the
 * real components, router, forms and pdf.js rendering.
 */
export async function installTauriStub(page: Page, options: StubOptions = {}): Promise<void> {
  const data = {
    theme: options.theme ?? 'system',
    pdfs: {
      report: base64('report.pdf'),
      notes: base64('notes.pdf'),
    },
    images: {
      'scan.png': base64('scan.png'),
      'photo.png': base64('photo.png'),
      'photo.heic': base64('flat_red_64.heic'),
    },
  };

  await page.addInitScript((fixtures) => {
    const internals = window as unknown as {
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: (event: string, id: number) => void };
      __PDF_HOLD__?: boolean;
      __PDF_CANCEL_REQUESTED__?: boolean;
    };

    internals.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    };

    try {
      const raw = localStorage.getItem('pdf-toolbox.settings');
      const settings = raw ? JSON.parse(raw) : {};
      settings.autoUpdate = false;
      if (fixtures.theme !== 'system') settings.theme = fixtures.theme;
      localStorage.setItem('pdf-toolbox.settings', JSON.stringify(settings));
    } catch {
      // A first navigation may not have an origin yet; the test sets it later.
    }

    const decode = (value: string): number[] => {
      const binary = atob(value);
      return Array.from(binary, (c) => c.charCodeAt(0));
    };

    const imageNames = Object.keys(fixtures.images);
    const findImage = (path: string): string | undefined =>
      imageNames.find((name) => path.toLowerCase().endsWith(name));

    const infoFor = (path: string): Record<string, unknown> => {
      const name = path.replace(/^.*[\\/]/, '');
      if (name === 'report.pdf') return { path, name, size: 1782, pages: 4, kind: 'pdf' };
      if (name === 'notes.pdf') return { path, name, size: 1013, pages: 2, kind: 'pdf' };
      if (name === 'scan.png') return { path, name, size: 1209, width: 480, height: 320, kind: 'image' };
      if (name === 'photo.png') return { path, name, size: 1470, width: 320, height: 480, kind: 'image' };
      if (name === 'photo.heic') return { path, name, size: 2637, width: 64, height: 64, kind: 'image' };
      return { path, name, size: 0, kind: 'pdf', error: 'Unsupported format' };
    };

    let heldResolver: (() => void) | null = null;

    const processResult = (command: string, args: Record<string, unknown>): Record<string, unknown> => {
      const outDir = (args['outDir'] as string | undefined) ?? '/output';
      const name = ({
        images_to_pdf: 'Scan and 1 more.pdf',
        merge_pdfs: 'Quarterly Report and 1 more (merged).pdf',
        split_pdf: 'Quarterly Report (pages 1-2).pdf',
        compress_pdfs: 'report (compressed).pdf',
        encrypt_pdfs: 'report (protected).pdf',
        decrypt_pdfs: 'report (unlocked).pdf',
        organize_pdf: 'report (organised).pdf',
        set_metadata: 'report (properties).pdf',
      } as Record<string, string>)[command] ?? 'Output.pdf';
      return {
        files: [{ name, path: `${outDir}/${name}`, size: 2048 }],
        outDir,
      };
    };

    const invoke = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
      if (command === 'plugin:path|resolve_directory') return '/home/test/Documents';
      if (command === 'plugin:path|join') {
        const paths = (args['paths'] as string[] | undefined) ?? [];
        return paths.join('/').replace(/\/+/g, '/').replace(/^\/?/, (m) => (m.startsWith('/') ? '/' : ''));
      }
      if (command === 'plugin:path|basename') {
        return String(args['path'] ?? '').replace(/^.*[\\/]/, '');
      }
      if (command === 'plugin:fs|exists') return false;
      if (command === 'plugin:fs|mkdir' || command === 'plugin:fs|write_file' || command === 'plugin:fs|write_text_file') return null;
      if (command === 'plugin:fs|read_file') {
        const path = String(args['path'] ?? '');
        if (path.endsWith('report.pdf')) return decode(fixtures.pdfs.report);
        if (path.endsWith('notes.pdf')) return decode(fixtures.pdfs.notes);
        const image = findImage(path);
        if (image) return decode(fixtures.images[image]);
        throw new Error(`Missing fixture for ${path}`);
      }
      if (command === 'plugin:dialog|open') {
        const dialog = (args['options'] as Record<string, unknown> | undefined) ?? {};
        if (dialog['directory']) return '/output';
        const filters = (dialog['filters'] as { extensions?: string[] }[] | undefined) ?? [];
        const extensions = filters.flatMap((filter) => filter.extensions ?? []);
        if (extensions.includes('pdf') && extensions.includes('png')) {
          return ['/fixtures/report.pdf', '/fixtures/scan.png'];
        }
        if (extensions.includes('png') || extensions.includes('heic')) {
          return ['/fixtures/scan.png', '/fixtures/photo.heic'];
        }
        return '/fixtures/report.pdf';
      }
      if (command === 'plugin:dialog|ask' || command === 'plugin:dialog|confirm') return false;
      if (command === 'plugin:dialog|message') return null;
      if (command.startsWith('plugin:opener|')) return null;
      if (command === 'plugin:event|listen') return 1;
      if (command === 'plugin:event|unlisten') return null;
      if (command === 'cancel_job') {
        internals.__PDF_CANCEL_REQUESTED__ = true;
        heldResolver?.();
        heldResolver = null;
        return null;
      }
      if (command === 'inspect_files') {
        const paths = (args['paths'] as string[] | undefined) ?? [];
        return paths.map(infoFor);
      }
      if (command === 'app_version') return '1.0.1';
      if (command === 'launch_files') return [];
      if (command === 'check_update') {
        return { currentVersion: '1.0.1', latestVersion: 'v1.0.1', updateAvailable: false };
      }
      if (command === 'get_metadata') {
        return {
          title: 'Quarterly Report', author: 'Test Author', subject: 'Results', keywords: 'quarterly, results',
          creator: 'PDF Toolbox', producer: 'PDF Toolbox',
        };
      }
      if (command === 'recent_outputs') {
        return [
          {
            name: 'Quarterly Report (compressed).pdf',
            path: '/output/Quarterly Report (compressed).pdf',
            size: 1200,
            modified: 1760000000000,
          },
        ];
      }
      if (command === 'estimate_compression') {
        const paths = (args['paths'] as string[] | undefined) ?? [];
        return paths.map((path) => ({ path, original: 1782, estimated: 1100 }));
      }
      if ([
        'images_to_pdf', 'merge_pdfs', 'split_pdf', 'compress_pdfs', 'encrypt_pdfs',
        'decrypt_pdfs', 'organize_pdf', 'set_metadata',
      ].includes(command)) {
        const channel = args['onProgress'] as { onmessage?: (value: unknown) => void } | undefined;
        if (internals.__PDF_HOLD__) {
          channel?.onmessage?.({ processed: 1, total: 2, message: 'Working on it…' });
          return new Promise((resolve) => {
            heldResolver = () => resolve({ files: [], outDir: (args['outDir'] as string) ?? '/output', stopped: true });
          });
        }
        channel?.onmessage?.({ processed: 1, total: 2, message: 'Working on it…' });
        return processResult(command, args);
      }
      throw new Error(`Unhandled Tauri command: ${command}`);
    };

    let callbackId = 1;
    const callbacks = new Map<number, (message: unknown) => void>();

    internals.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (callback: (message: unknown) => void) => {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: (path: string) => {
        const image = findImage(path);
        if (image === 'photo.heic') return `data:image/png;base64,${fixtures.images['scan.png']}`;
        if (image) return `data:image/png;base64,${fixtures.images[image]}`;
        return path;
      },
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    };
  }, data);
}

/** Holds the next processing command open so the Cancel button is visible. */
export async function holdProcessing(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __PDF_HOLD__?: boolean }).__PDF_HOLD__ = true;
  });
}

export async function releaseProcessing(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __PDF_HOLD__?: boolean }).__PDF_HOLD__ = false;
  });
}

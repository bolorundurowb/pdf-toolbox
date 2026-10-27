import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { holdProcessing, installTauriStub, releaseProcessing } from './tauri-stub';

const TOOLS = [
  { name: 'Image to PDF', path: 'images' },
  { name: 'Merge', path: 'merge' },
  { name: 'Compress', path: 'compress' },
  { name: 'Security', path: 'security' },
  { name: 'Organise', path: 'organize' },
  { name: 'Extract', path: 'extract' },
  { name: 'Convert', path: 'convert' },
  { name: 'Metadata', path: 'metadata' },
  { name: 'Settings', path: 'settings' },
];

const SIZES = [
  { width: 768, height: 510 },
  { width: 1032, height: 725 },
  { width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await installTauriStub(page);
});

async function goto(page: Page, path: string): Promise<void> {
  await page.goto(`/#/${path}`);
  await page.waitForLoadState('networkidle');
  await waitForFonts(page);
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function addFile(page: Page, path: string): Promise<void> {
  await page.getByRole('button', { name: /choose files/i }).first().click();
  const file = path === 'images' ? 'scan.png' : 'report.pdf';
  await expect(page.getByText(file, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  if (path === 'images') {
    // The HEIC fixture from the decoder's test data is accepted too.
    await expect(page.getByText('photo.heic', { exact: false }).first()).toBeVisible();
  }
}

async function noOverlap(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const sidebar = document.querySelector('aside')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    return Boolean(sidebar && main && sidebar.right > main.left + 1);
  });
  expect(overlaps, 'sidebar and main panel should not overlap').toBe(false);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 0;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow, 'main panel should not scroll horizontally').toBeLessThanOrEqual(1);
}

async function expectAccessible(page: Page): Promise<void> {
  // Let the 150 ms enabled/disabled transition settle before axe measures
  // composited colours.
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length > 0) {
    console.log(JSON.stringify(serious.map((v) => ({
      id: v.id,
      help: v.help,
      nodes: v.nodes.map((node) => ({
        target: node.target.join(' '),
        html: node.html,
        summary: node.failureSummary,
      })).slice(0, 12),
    }))));
  }
  expect(
    serious.map((v) => `${v.id}: ${v.help}`),
    'serious or critical accessibility violations',
  ).toEqual([]);
}

for (const size of SIZES) {
  test(`layout fits ${size.width} by ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const view of [{ name: 'Dashboard', path: 'dashboard' }, ...TOOLS]) {
      await goto(page, view.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (view.path !== 'settings') {
        await expect(page.getByRole('button', { name: /choose files/i }).first()).toBeVisible();
      }
      if (view.path !== 'dashboard' && view.path !== 'settings') {
        await expect(page.locator('.btn-action').first()).toBeVisible();
      }
      await noHorizontalOverflow(page);
      await noOverlap(page);
    }
  });
}

test('empty tool pages are accessible', async ({ page }) => {
  for (const view of [{ name: 'Dashboard', path: 'dashboard' }, ...TOOLS]) {
    await goto(page, view.path);
    await expectAccessible(page);
  }
});

test('each tool shows a loaded file and stays inside the panel', async ({ page }) => {
  for (const tool of TOOLS.filter((item) => item.path !== 'settings')) {
    await goto(page, tool.path);
    await addFile(page, tool.path);
    await noHorizontalOverflow(page);
    await expectAccessible(page);
  }
});

test('the dashboard chooser routes a dropped PDF to Merge', async ({ page }) => {
  await goto(page, 'dashboard');
  await page.getByRole('button', { name: /choose files/i }).click();
  await expect(page.getByRole('heading', { name: 'Open in a tool' })).toBeVisible();
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page).toHaveURL(/#\/merge/);
  await expect(page.getByText('report.pdf', { exact: false }).first()).toBeVisible();
});

test('Cancel stops a held job between files', async ({ page }) => {
  await goto(page, 'compress');
  await addFile(page, 'compress');
  await holdProcessing(page);
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job stopped' })).toBeVisible({ timeout: 10_000 });
  await releaseProcessing(page);
});

test('a finished job reports what it saved', async ({ page }) => {
  await goto(page, 'images');
  await addFile(page, 'images');
  await page.getByRole('button', { name: /Convert to PDF/i }).click();
  await expect(page.getByRole('heading', { name: 'PDF created' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Scan and 1 more.pdf')).toBeVisible();
});

test('Ctrl+O adds and Ctrl+Enter runs on Merge', async ({ page }) => {
  await goto(page, 'merge');
  await page.keyboard.press('Control+O');
  expect(page.getByText('report.pdf', { exact: false }).first()).toBeVisible();
  await page.keyboard.press('Control+O');
  await expect(page.getByText('Files to combine (2)')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'PDFs merged' })).toBeVisible({ timeout: 10_000 });
});

test('a page preview opens on double-click and closes with Escape', async ({ page }) => {
  await goto(page, 'organize');
  await addFile(page, 'organize');
  const tile = page.getByLabel('Page 1', { exact: true });
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.dblclick();
  await expect(page.getByRole('dialog', { name: 'Page preview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Page preview' })).toBeHidden();
});

test('keyboard focus is visible on the drop zone', async ({ page }) => {
  await goto(page, 'images');
  const zone = page.getByRole('button', { name: /drag and drop images/i });
  await zone.focus();
  const outline = await zone.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe('none');
  expect(parseFloat(outline.width)).toBeGreaterThan(0);
});

test('every tool reaches its done screen', async ({ page }) => {
  const cases: {
    path: string;
    action: RegExp;
    title: string;
    prepare?: () => Promise<void>;
    repeat?: boolean;
  }[] = [
    { path: 'images', action: /Convert to PDF/i, title: 'PDF created' },
    { path: 'merge', action: /Merge PDFs/i, title: 'PDFs merged', repeat: true },
    { path: 'compress', action: /^Compress$/i, title: 'PDFs compressed' },
    {
      path: 'security',
      action: /^Protect$/i,
      title: 'PDFs protected',
      prepare: async () => {
        await page.getByLabel('Password to open').fill('secret');
        await page.getByLabel('Confirm password').fill('secret');
      },
    },
    { path: 'organize', action: /Save PDF/i, title: 'Pages organised' },
    { path: 'extract', action: /Extract text/i, title: 'Text extracted' },
    { path: 'convert', action: /Convert to Word/i, title: 'Word document ready' },
    { path: 'metadata', action: /Save metadata/i, title: 'Metadata saved' },
  ];

  for (const item of cases) {
    await goto(page, item.path);
    await addFile(page, item.path);
    if (item.repeat) {
      await page.keyboard.press('Control+O');
      await expect(page.getByText('Files to combine (2)')).toBeVisible();
    }
    await item.prepare?.();
    await page.getByRole('button', { name: item.action }).first().click();
    await expect(page.getByRole('heading', { name: item.title })).toBeVisible({ timeout: 20_000 });
  }
});

test('Tab reaches the file area, options and primary action with visible focus', async ({ page }) => {
  await goto(page, 'images');
  await addFile(page, 'images');
  // Click a non-focusable heading so Tab starts from the top of the page
  // rather than the button that was clicked.
  await page.getByRole('heading', { level: 1 }).click();

  let sawFile = false;
  let sawOption = false;
  let sawAction = false;

  for (let i = 0; i < 80 && !sawAction; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const style = getComputedStyle(element);
      const label = element.closest('label');
      return {
        text: `${element.innerText ?? ''} ${label?.innerText ?? ''} ${element.getAttribute('aria-label') ?? ''}`,
        tag: element.tagName,
        type: (element as HTMLInputElement).type ?? '',
        outline: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });
    if (!info) break;

    if (/drag and drop images|choose files/i.test(info.text)) {
      sawFile = true;
      expect(info.outline).not.toBe('none');
      expect(info.width).toBeGreaterThan(0);
    }
    if (info.tag === 'SELECT' || (info.tag === 'INPUT' && ['radio', 'range', 'text'].includes(info.type))) {
      sawOption = true;
      expect(info.outline).not.toBe('none');
      expect(info.width).toBeGreaterThan(0);
    }
    if (/convert to pdf/i.test(info.text)) {
      sawAction = true;
      expect(info.outline).not.toBe('none');
      expect(info.width).toBeGreaterThan(0);
    }
  }

  expect(sawFile, 'drop zone in the tab order').toBe(true);
  expect(sawOption, 'options in the tab order').toBe(true);
  expect(sawAction, 'primary action in the tab order').toBe(true);
});

test('visual: dashboard and settings in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await goto(page, 'dashboard');
    if (theme === 'dark') await setTheme(page, 'dark');
    await expect(page.getByText('Checking for updates…')).toBeHidden();
    await expect(page).toHaveScreenshot(`dashboard-${theme}.png`, { fullPage: false });

    await goto(page, 'settings');
    await expect(page.getByText('Checking for updates…')).toBeHidden();
    await expect(page).toHaveScreenshot(`settings-${theme}.png`, { fullPage: false });
  }
});

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    const raw = localStorage.getItem('pdf-toolbox.settings');
    const settings = raw ? JSON.parse(raw) : {};
    localStorage.setItem('pdf-toolbox.settings', JSON.stringify({ ...settings, theme: value }));
  }, theme);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await waitForFonts(page);
}

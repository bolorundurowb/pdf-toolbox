/**
 * Page-range parsing and formatting, shared by every page picker.
 *
 * Mirrors `src-tauri/src/pdf/util.rs::parse_ranges` so what the UI highlights and
 * what the backend writes can never disagree.
 */

export type PageRange = [start: number, end: number];

/** Parses `"1-5, 8, 11-13"` into inclusive ranges clamped to `1..=max`. */
export function parseRanges(text: string, max: number): PageRange[] {
  const out: PageRange[] = [];
  for (const raw of (text || '').split(',')) {
    const token = raw.trim();
    if (!token) continue;

    const span = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (span) {
      let a = +span[1];
      let b = +span[2];
      if (a > b) [a, b] = [b, a];
      a = Math.max(1, a);
      b = Math.min(max, b);
      if (a <= b) out.push([a, b]);
    } else if (/^\d+$/.test(token)) {
      const p = +token;
      if (p >= 1 && p <= max) out.push([p, p]);
    }
  }
  return out;
}

/** Expands ranges into a sorted, de-duplicated list of page numbers. */
export function rangesToPages(ranges: readonly PageRange[]): number[] {
  const seen = new Set<number>();
  for (const [a, b] of ranges) {
    for (let n = a; n <= b; n++) seen.add(n);
  }
  return [...seen].sort((x, y) => x - y);
}

/** Collapses page numbers back into the shortest range text: `1-5, 8, 11-13`. */
export function pagesToRangeText(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

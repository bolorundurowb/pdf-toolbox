import { PdfTextItem } from './pdf-render.service';

/**
 * Reconstructs reading order from the raw glyph runs pdf.js reports, grouping
 * them into lines (by baseline y) and then paragraphs (by vertical gaps). The
 * result is a best-effort layout that is far more useful than a flat stream of
 * characters, while staying honest about what a text-only conversion can do.
 */

export interface TextBlock {
  text: string;
  /** A short line clearly larger than the page's body text. */
  heading: boolean;
  /** 1 for a large title, 2 for a smaller section heading. */
  level: 1 | 2;
}

interface Line {
  y: number; // baseline, PDF space (larger = higher on the page)
  size: number; // approximate font size in points
  words: string[];
  xs: number[];
  ends: number[];
}

export function pageToParagraphs(items: PdfTextItem[]): TextBlock[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Line[] = [];
  for (const item of sorted) {
    const cur = lines[lines.length - 1];
    const tolerance = Math.max(2, item.fontSize * 0.5);
    if (cur && Math.abs(item.y - cur.y) <= tolerance) {
      cur.words.push(item.str);
      cur.xs.push(item.x);
      cur.ends.push(item.x + item.str.length * item.fontSize * 0.5);
      cur.size = Math.max(cur.size, item.fontSize);
    } else {
      lines.push({
        y: item.y,
        size: item.fontSize,
        words: [item.str],
        xs: [item.x],
        ends: [item.x + item.str.length * item.fontSize * 0.5],
      });
    }
  }

  const lineTexts: { text: string; y: number; size: number }[] = [];
  for (const line of lines) {
    const order = line.words.map((_, i) => i).sort((a, b) => line.xs[a] - line.xs[b]);
    let text = '';
    let prevEnd: number | null = null;
    for (const i of order) {
      if (prevEnd != null && line.xs[i] - prevEnd > Math.max(1, line.size * 0.3)) {
        text += ' ';
      }
      text += line.words[i];
      prevEnd = line.ends[i];
    }
    const trimmed = text.trim();
    if (trimmed) lineTexts.push({ text: trimmed, y: line.y, size: line.size });
  }

  // The page's body size is the median line size; headings stand out from it.
  const bodySize = median(lineTexts.map((line) => line.size)) || 0;
  const blocks: TextBlock[] = [];
  let current: string[] = [];
  let prevY: number | null = null;
  let prevSize = 0;

  const flush = (): void => {
    const joined = current.join(' ').trim();
    if (joined) blocks.push({ text: joined, heading: false, level: 2 });
    current = [];
  };

  for (const line of lineTexts) {
    const heading = bodySize > 0
      && line.text.length <= 80
      && line.size >= bodySize * 1.25;
    if (heading) {
      flush();
      blocks.push({
        text: line.text,
        heading: true,
        level: line.size >= bodySize * 1.6 ? 1 : 2,
      });
      prevY = line.y;
      prevSize = line.size;
      continue;
    }

    if (prevY == null) {
      current.push(line.text);
    } else {
      const gap = prevY - line.y;
      const threshold = Math.max(prevSize, line.size) * 1.6;
      if (gap > threshold) flush();
      current.push(line.text);
    }
    prevY = line.y;
    prevSize = line.size;
  }
  flush();

  return blocks;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

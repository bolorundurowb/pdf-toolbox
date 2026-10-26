import { InputFile } from './models';
import { pagesToRangeText } from './page-ranges';

/** `Scan` for one file, `Scan and 3 more` for several. */
export function firstAndMore(items: readonly { name: string }[]): string {
  if (items.length === 0) return 'Document';
  const first = stemOf(items[0].name) || 'Document';
  return items.length > 1 ? `${first} and ${items.length - 1} more` : first;
}

export function stemOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** A user-typed name wins; otherwise the suggestion from the source files. */
export function outputBase(typed: string, suggestion: string, extensionPattern = /\.[^.]+$/): string {
  const custom = typed.trim().replace(extensionPattern, '').trim();
  return custom || suggestion;
}

export function withOperation(base: string, operation: string): string {
  return `${base} (${operation})`;
}

export function mergeSuggestion(files: readonly InputFile[]): string {
  return withOperation(firstAndMore(files), 'merged');
}

export function imagesSuggestion(files: readonly InputFile[]): string {
  return firstAndMore(files);
}

export function pagesName(base: string, pages: readonly number[]): string {
  const text = pagesToRangeText(pages);
  return `${base} (${pages.length === 1 ? 'page' : 'pages'} ${text})`;
}

export function partName(base: string, part: number, total: number): string {
  return `${base} (part ${part} of ${total})`;
}

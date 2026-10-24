import { InputFile } from './models';

/** Appends `added` to `current`, skipping any path that is already listed. */
export function mergeUnique<T extends InputFile>(current: readonly T[], added: readonly T[]): T[] {
  const seen = new Set(current.map((f) => f.path));
  const next = [...current];
  for (const f of added) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    next.push(f);
  }
  return next;
}

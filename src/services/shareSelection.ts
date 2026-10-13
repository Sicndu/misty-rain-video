import type { QuarkShareEntry } from './quarkStreamService';

/** Keep descendants selected explicitly so a child can be excluded from a checked folder. */
export const toggleShareEntry = (entries: QuarkShareEntry[], selection: Set<string>, entry: QuarkShareEntry) => {
  const next = new Set(selection);
  const descendants = entries.filter(item => item.fid === entry.fid || item.ancestorFids.includes(entry.fid));
  if (selection.has(entry.fid)) {
    for (const item of descendants) next.delete(item.fid);
    for (const fid of entry.ancestorFids) next.delete(fid);
  } else {
    for (const item of descendants) next.add(item.fid);
  }
  return next;
};

export const compactShareSelection = (entries: QuarkShareEntry[], selection: Set<string>) => entries
  .filter(item => selection.has(item.fid) && !item.ancestorFids.some(fid => selection.has(fid)))
  .map(item => item.fid);

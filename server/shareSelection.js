const selectionError = (message, code = 'QUARK_SELECTION_INVALID') => Object.assign(new Error(message), {
  code, statusCode: 422
});

/** Only server-enumerated entries carry share tokens; client input is a list of FIDs. */
export const resolveShareSelection = (entries, selectedFids, { allowMissing = false } = {}) => {
  if (!Array.isArray(selectedFids) || !selectedFids.length || selectedFids.length > 5000
    || selectedFids.some(fid => typeof fid !== 'string' || !fid.trim() || fid.length > 240)) {
    throw selectionError('请至少选择一个有效的文件或文件夹');
  }
  const ids = new Set(selectedFids);
  const byId = new Map(entries.map(item => [item.fid, item]));
  if (!allowMissing && [...ids].some(fid => !byId.has(fid))) {
    throw selectionError('所选资源已发生变化，请重新打开详情选择', 'QUARK_SELECTION_STALE');
  }
  return entries.filter(item => ids.has(item.fid) && !item.ancestorFids.some(fid => ids.has(fid)));
};

export const entriesInSelection = (entries, selectedEntries) => {
  const ids = new Set(selectedEntries.map(item => item.fid));
  return entries.filter(item => ids.has(item.fid) || item.ancestorFids.some(fid => ids.has(fid)));
};

/** Preserve the share's directory hierarchy, including equal filenames in different seasons. */
export const groupShareTransfers = entries => {
  const groups = new Map();
  for (const item of entries) {
    const key = JSON.stringify(item.ancestorFids);
    if (!groups.has(key)) groups.set(key, { ancestorFids: item.ancestorFids, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
};

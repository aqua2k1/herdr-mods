// A sidebar never becomes the diff pane: only model panes in the active tab do.
// Mirrors Files Plus' right-split preview, with a separate channel per mod.
export const PREVIEW_MOD = "changes-plus";
export const previewChannel = tab => `changes-plus.diff.${tab}`;

export function previewTarget(panes, focused) {
  const tab = focused?.tab;
  if (!tab) return null;
  const inTab = panes.filter(p => p.tab === tab);
  const preview = inTab.find(p => p.mod === PREVIEW_MOD);
  const work = inTab.find(p => p.pane === focused.pane && p.mod !== PREVIEW_MOD) ??
    inTab.find(p => p.terminal) ?? inTab.find(p => p.mod !== PREVIEW_MOD);
  return { tab, preview, work, channel: previewChannel(tab) };
}
